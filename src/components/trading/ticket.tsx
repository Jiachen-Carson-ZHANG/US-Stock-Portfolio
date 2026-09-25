"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";
import { Help } from "@/components/ui/help";
import { QuoteDetailPanel } from "@/components/market/quote-detail";
import { quoteDetail } from "@/lib/market/detail";
import { marketSession, quotePollIntervalMs } from "@/lib/market-hours";
import { formatMoney } from "@/lib/money";
import { cn, signClass } from "@/lib/utils";
import type { Order } from "@/lib/trading/orders";
import type { MarketSession } from "@/types/market";

type Side = "buy" | "sell";
type Kind = "market" | "limit" | "stop";
type Tif = "day" | "gtc";

type Quote = {
  symbol: string;
  price: number;
  previousClose?: number;
  changePercent: number;
  name?: string;
  greeks?: {
    impliedVolatility?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    openInterest?: number;
  };
  session?: {
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
  };
  raw?: Record<string, unknown>;
};


/**
 * The market's session, re-read every minute.
 *
 * The server renders as if the market were open and the browser corrects it
 * once it has hydrated, because the two clocks need not agree on which side
 * of 9:30 it is — and a mismatch between them is an error, not a detail.
 */
function useMarketSession(): MarketSession {
  return useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, 60_000);
      return () => clearInterval(timer);
    },
    () => marketSession(),
    () => "regular",
  );
}

/** Options are quoted per share and trade in hundreds. */
function contractSize(symbol: string): number {
  return /^[A-Z]+\d{6}[CP]\d+$/.test(symbol) ? 100 : 1;
}

/**
 * The order ticket.
 *
 * Two steps on purpose: fill it in, then read back what you are about to do
 * before it happens. A single button that both prices and submits is how
 * somebody buys a hundred contracts meaning a hundred shares.
 */
export function Ticket({
  portfolioSlug,
  currency,
  initialBuyingPower,
}: {
  portfolioSlug: string;
  currency: string;
  initialBuyingPower: string;
}) {
  const t = useT();
  const router = useRouter();

  const [side, setSide] = useState<Side>("buy");
  const [kind, setKind] = useState<Kind>("market");
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [tif, setTif] = useState<Tif>("day");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [power, setPower] = useState(initialBuyingPower);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  // Priced as it is typed, so the estimate below is never a guess about a
  // symbol nobody has looked up. Debounced, because a quote per keystroke is
  // a round trip per keystroke.
  useEffect(() => {
    const ticker = symbol.trim().toUpperCase();
    let cancelled = false;

    const timer = setTimeout(() => {
      if (ticker.length < 1) {
        if (!cancelled) setQuote(null);
        return;
      }

      void fetch(`/api/market/quotes?symbols=${encodeURIComponent(ticker)}&portfolio=${encodeURIComponent(portfolioSlug)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (cancelled) return;
          setQuote(body?.quotes?.[0] ?? null);
        })
        .catch(() => {});
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol, portfolioSlug]);

  const session = useMarketSession();
  const ticker = symbol.trim().toUpperCase();
  const shares = Number(quantity);
  // A stop already past its trigger would go off the moment it was placed.
  // The server refuses it; saying so here, while the numbers are still being
  // typed, is kinder than a refusal after Review.
  const stop = Number(stopPrice);
  const stopTriggered =
    kind === "stop" &&
    quote !== null &&
    stop > 0 &&
    (side === "buy" ? quote.price >= stop : quote.price <= stop);
  const reference =
    kind === "market" ? (quote?.price ?? 0) : Number(kind === "limit" ? limitPrice : stopPrice);
  const estimate =
    Number.isFinite(shares) && shares > 0 && reference > 0
      ? shares * reference * contractSize(ticker)
      : 0;

  const ready =
    ticker.length > 0 &&
    Number.isInteger(shares) &&
    shares > 0 &&
    (kind !== "limit" || Number(limitPrice) > 0) &&
    (kind !== "stop" || (Number(stopPrice) > 0 && !stopTriggered));

  async function place() {
    setBusy(true);
    setMessage(null);

    const response = await fetch(
      `/api/orders?portfolio=${encodeURIComponent(portfolioSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: ticker,
          side,
          kind,
          quantity: shares,
          ...(kind === "limit" ? { limitPrice: Number(limitPrice) } : {}),
          ...(kind === "stop" ? { stopPrice: Number(stopPrice) } : {}),
          timeInForce: tif,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      // The server sends a category alongside the headline when it has one.
      // "Could not place the order" by itself tells nobody what to do next.
      setMessage({
        tone: "bad",
        text: [body.error ?? t.trade.failed, body.reason].filter(Boolean).join(" "),
      });
      setReviewing(false);
      return;
    }

    setPower(body.buyingPower ?? power);
    setMessage({
      tone: "ok",
      text: body.filled
        ? `${t.trade.filled} · ${formatMoney({ amount: String(body.order.fillPrice), currency })}`
        : session === "regular"
          ? t.trade.resting
          : t.trade.restingUntilOpen,
    });
    setReviewing(false);
    setQuantity("");
    setLimitPrice("");
    setStopPrice("");
    router.refresh();
  }

  const money = (value: number) => formatMoney({ amount: String(value), currency });

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t.trade.title}</h2>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {t.trade.buyingPower}{" "}
          <span className="tabular text-foreground">{money(Number(power))}</span>
          <Help title={t.help.buyingPower} align="right">
            {t.help.buyingPowerBody}
          </Help>
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t.trade.subtitle}</p>

      {reviewing ? (
        <div className="mt-4 space-y-4">
          <dl className="space-y-1.5 rounded-lg border border-border p-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t.trade.side}</dt>
              <dd className={cn("font-medium", side === "buy" ? "text-positive" : "text-negative")}>
                {side === "buy" ? t.trade.buy : t.trade.sell}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t.trade.symbol}</dt>
              <dd className="font-medium">{ticker}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t.trade.quantity}</dt>
              <dd className="tabular">
                {shares}
                {contractSize(ticker) === 100 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    × {contractSize(ticker)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t.trade.orderType}</dt>
              <dd>
                {kind === "market" ? t.trade.market : kind === "limit" ? t.trade.limit : t.trade.stop}
                {kind !== "market" && (
                  <span className="tabular ml-1">
                    {money(Number(kind === "limit" ? limitPrice : stopPrice))}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-1.5">
              <dt className="text-muted-foreground">{t.trade.estimated}</dt>
              <dd className="tabular font-medium">{money(estimate)}</dd>
            </div>
          </dl>

          {(kind !== "market" || session !== "regular") && (
            <p className="text-xs text-muted-foreground">{t.trade.restingNote}</p>
          )}

          <div className="flex gap-2">
            <Button onClick={place} disabled={busy}>
              {busy ? t.trade.placing : t.trade.place}
            </Button>
            <Button variant="ghost" onClick={() => setReviewing(false)} disabled={busy}>
              {t.trade.back}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex gap-1">
            {(["buy", "sell"] as Side[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSide(option)}
                aria-pressed={side === option}
                className={cn(
                  "min-h-9 flex-1 rounded-lg border text-sm transition-colors",
                  side === option
                    ? option === "buy"
                      ? "border-positive bg-positive/10 font-medium text-positive"
                      : "border-negative bg-negative/10 font-medium text-negative"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {option === "buy" ? t.trade.buy : t.trade.sell}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-symbol" className="text-xs text-muted-foreground">
                {t.trade.symbol}
              </Label>
              <Input
                id="ticket-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                autoCapitalize="characters"
                autoCorrect="off"
                placeholder="NVDA"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-quantity" className="text-xs text-muted-foreground">
                {t.trade.quantity}
              </Label>
              <Input
                id="ticket-quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="numeric"
                placeholder="10"
              />
            </div>
          </div>

          {quote ? (
            <div className="space-y-1">
              <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-medium">{quote.symbol}</span>
                <span className="tabular">{money(quote.price)}</span>
                <span className={cn("tabular text-xs", signClass(quote.changePercent))}>
                  {quote.changePercent >= 0 ? "+" : ""}
                  {quote.changePercent.toFixed(2)}%
                </span>
                {quote.name && (
                  <span className="text-xs text-muted-foreground">{quote.name}</span>
                )}
              </p>

              {/* Everything the broker publishes about this symbol: the day's
                  range, bid and ask, and for an option its greeks, strike and
                  days to expiry. A price on its own is the least informative
                  number on a trading screen, and buying a contract without
                  seeing its delta and daily decay is a guess, not a trade. */}
              <QuoteDetailPanel detail={quoteDetail(quote.symbol, quote.raw)} compactView />

              {contractSize(ticker) === 100 && (
                <p className="text-xs text-muted-foreground">{t.trade.perContract}</p>
              )}
            </div>
          ) : ticker.length > 0 ? (
            <p className="text-xs text-muted-foreground">{t.trade.quoteUnavailable}</p>
          ) : null}

          <div className="space-y-1.5">
            <Label
              htmlFor="ticket-kind"
              className="flex items-center gap-1 text-xs text-muted-foreground"
            >
              {t.trade.orderType}
              <Help title={t.help.orderKinds}>{t.help.orderKindsBody}</Help>
            </Label>
            <select
              id="ticket-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as Kind)}
              className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
            >
              <option value="market">{t.trade.market}</option>
              <option value="limit">{t.trade.limit}</option>
              <option value="stop">{t.trade.stop}</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {kind === "market"
                ? t.trade.marketHint
                : kind === "limit"
                  ? t.trade.limitHint
                  : t.trade.stopHint}
            </p>
            {session !== "regular" && (
              <p className="text-xs text-foreground">{t.trade.outsideHours}</p>
            )}
          </div>

          {kind !== "market" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-price" className="text-xs text-muted-foreground">
                  {kind === "limit" ? t.trade.limitPrice : t.trade.stopPrice}
                </Label>
                <Input
                  id="ticket-price"
                  value={kind === "limit" ? limitPrice : stopPrice}
                  onChange={(event) =>
                    kind === "limit"
                      ? setLimitPrice(event.target.value)
                      : setStopPrice(event.target.value)
                  }
                  inputMode="decimal"
                  placeholder={quote ? quote.price.toFixed(2) : "0.00"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-tif" className="text-xs text-muted-foreground">
                  {t.trade.timeInForce}
                </Label>
                <select
                  id="ticket-tif"
                  value={tif}
                  onChange={(event) => setTif(event.target.value as Tif)}
                  className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
                >
                  <option value="day">{t.trade.day}</option>
                  <option value="gtc">{t.trade.gtc}</option>
                </select>
              </div>
            </div>
          )}

          {stopTriggered && quote && (
            <p role="alert" className="text-xs text-negative">
              {(side === "buy" ? t.trade.buyStopTriggered : t.trade.sellStopTriggered).replace(
                "{price}",
                money(quote.price),
              )}
            </p>
          )}

          {estimate > 0 && (
            <p className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t.trade.estimated}</span>
              <span className="tabular font-medium">{money(estimate)}</span>
            </p>
          )}

          {message && (
            <p
              role="status"
              className={cn("text-sm", message.tone === "ok" ? "text-positive" : "text-negative")}
            >
              {message.text}
            </p>
          )}

          <Button onClick={() => setReviewing(true)} disabled={!ready} className="w-full">
            {t.trade.review}
          </Button>
        </div>
      )}
    </section>
  );
}

const STATUS_TONE: Record<Order["status"], string> = {
  open: "text-muted-foreground",
  filled: "text-positive",
  cancelled: "text-muted-foreground",
  expired: "text-muted-foreground",
  rejected: "text-negative",
};

/** What is resting, and what has happened. */
export function OrderList({
  portfolioSlug,
  orders: initialOrders,
  canCancel,
  currency,
}: {
  portfolioSlug: string;
  orders: Order[];
  canCancel: boolean;
  currency: string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [orders, setOrders] = useState(initialOrders);

  // When the server sends a newer list — after a cancel, a new order, or a
  // refresh triggered below — that answer wins over anything polled. Adjusted
  // during render rather than in an effect, which is the pattern React
  // documents for resetting state when a prop changes: an effect would render
  // the stale list once before correcting it.
  const [fromServer, setFromServer] = useState(initialOrders);
  if (fromServer !== initialOrders) {
    setFromServer(initialOrders);
    setOrders(initialOrders);
  }

  // A server render is a photograph. The page arrives with what was resting
  // at that instant and then goes quiet, so an order could fill and nothing
  // on screen would say so until somebody pressed reload.
  //
  // While anything is open, this asks again on the market's own cadence —
  // five seconds in the regular session, thirty in extended hours, never when
  // the market is shut, because a closed market cannot reach a price. The
  // request also prices and fills those orders server-side, so watching the
  // screen is what a broker feels like rather than a polite lie.
  const anyOpen = orders.some((order) => order.status === "open");

  useEffect(() => {
    if (!anyOpen) return;
    const every = quotePollIntervalMs(marketSession());
    if (every === null) return;

    let stopped = false;

    async function poll() {
      try {
        const response = await fetch(
          `/api/orders?portfolio=${encodeURIComponent(portfolioSlug)}`,
          { cache: "no-store" },
        );
        if (!response.ok || stopped) return;
        const body: { orders?: Order[] } = await response.json();
        if (!body.orders || stopped) return;

        setOrders((current) => {
          // Only when something actually happened. A fill changes cash and
          // holdings, which live on other parts of the page, so the server
          // components are asked for again — but doing that every five
          // seconds regardless would re-render the whole screen for nothing.
          const before = current.map((o) => `${o.id}:${o.status}`).join();
          const after = body.orders!.map((o) => `${o.id}:${o.status}`).join();
          if (before !== after) router.refresh();
          return body.orders!;
        });
      } catch {
        // A dropped poll is not worth showing anybody. The next one is five
        // seconds away.
      }
    }

    const timer = setInterval(() => void poll(), every);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [anyOpen, portfolioSlug, router]);

  const open = orders.filter((order) => order.status === "open");
  const past = orders.filter((order) => order.status !== "open");

  const label: Record<Order["status"], string> = {
    open: t.trade.statusOpen,
    filled: t.trade.statusFilled,
    cancelled: t.trade.statusCancelled,
    expired: t.trade.statusExpired,
    rejected: t.trade.statusRejected,
  };

  async function cancel(id: string) {
    setBusy(id);
    await fetch(`/api/orders?portfolio=${encodeURIComponent(portfolioSlug)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: id }),
    });
    setBusy(null);
    router.refresh();
  }

  const money = (value: number) => formatMoney({ amount: String(value), currency });

  function describe(order: Order): string {
    const kind =
      order.kind === "market"
        ? t.trade.market
        : order.kind === "limit"
          ? `${t.trade.limit} ${money(order.limitPrice ?? 0)}`
          : `${t.trade.stop} ${money(order.stopPrice ?? 0)}`;
    return `${order.side === "buy" ? t.trade.buy : t.trade.sell} ${order.quantity} · ${kind}`;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">{t.trade.openOrders}</h2>
        {open.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t.trade.noOpenOrders}</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-border">
              {open.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{order.symbol}</p>
                    <p className="text-xs text-muted-foreground">{describe(order)}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.lastCheckedAt
                        ? `${t.trade.lastChecked} ${new Date(order.lastCheckedAt).toLocaleTimeString()}`
                        : t.trade.neverChecked}
                    </p>
                  </div>
                  {canCancel && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === order.id}
                      onClick={() => cancel(order.id)}
                    >
                      {busy === order.id ? t.trade.cancelling : t.trade.cancel}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
              {t.trade.restingNote}
            </p>
          </>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">{t.trade.history}</h2>
        {past.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t.trade.noHistory}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {past.slice(0, 20).map((order) => (
              <li key={order.id} className="flex flex-wrap items-baseline gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{order.symbol}</p>
                  <p className="text-xs text-muted-foreground">{describe(order)}</p>
                  {order.note && (
                    <p className="text-xs text-muted-foreground">{order.note}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className={cn("text-xs font-medium", STATUS_TONE[order.status])}>
                    {label[order.status]}
                  </p>
                  {order.fillPrice !== null && (
                    <p className="tabular text-xs text-muted-foreground">
                      {money(order.fillPrice)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
