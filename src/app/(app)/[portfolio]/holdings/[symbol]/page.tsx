import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Layers, MessagesSquare, ShoppingCart } from "lucide-react";
import { currentLocale } from "@/lib/i18n/server";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { requirePortfolio } from "@/lib/portfolios/context";
import { loadPortfolio } from "@/lib/portfolio/service";
import { getMarketDataProvider } from "@/providers";
import { daysToExpiration } from "@/lib/portfolio";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { symbolSchema } from "@/lib/schemas";
import { parseSymbol } from "@/lib/moomoo/symbols";
import { visibleTo } from "@/lib/portfolios";
import { Badge } from "@/components/ui/misc";
import { MarketPanel } from "@/components/market/market-panel";
import { StockChart } from "@/components/market/stock-chart";
import { StockNotes } from "@/components/market/stock-notes";
import { WatchButton } from "@/components/market/watch-button";
import { quoteDetail } from "@/lib/market/detail";
import { getQuotes } from "@/lib/portfolio/quotes";
import { getDb } from "@/lib/db";
import type { PositionView } from "@/types/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The month of daily candles the chart opens on; other ranges load on demand. */
const HISTORY_DAYS = 31;

/**
 * One page for any symbol — held or not.
 *
 * It used to exist only for things in the account, and answered anything else
 * with "not found": a stock you searched for, or the share under an option
 * spread, had nowhere to go. Now the same page serves all of them. Price,
 * trading and the market's figures come first, because they apply to anyone;
 * your own position, and any options you hold on it, follow when there are
 * some.
 */
export default async function StockPage({
  params,
}: {
  params: Promise<{ portfolio: string; symbol: string }>;
}) {
  const routeParams = await params;
  const { user, portfolio } = await requirePortfolio(routeParams.portfolio);
  const zh = (await currentLocale()) === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);

  const parsed = symbolSchema.safeParse(decodeURIComponent(routeParams.symbol).toUpperCase());
  if (!parsed.success) notFound();
  const symbol = parsed.data;
  const terms = parseSymbol(symbol);
  const underlying = terms.instrumentType === "option" ? terms.underlyingSymbol : undefined;

  const db = await getDb();
  const provider = await getMarketDataProvider(portfolio.id);
  const to = new Date();
  const from = new Date(to.getTime() - HISTORY_DAYS * 86_400_000);

  // Asked for together, and none of them allowed to take the page down.
  const [data, quotes, history, watched, visible] = await Promise.all([
    loadPortfolio(portfolio.id).catch(() => null),
    getQuotes(db, underlying ? [symbol, underlying] : [symbol], provider, to)
      .then((result) => result.quotes)
      .catch(() => new Map()),
    provider
      .getHistoricalPrices(symbol, {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      })
      .catch(() => []),
    db.get<{ one: number }>(`SELECT 1 AS one FROM watch_items WHERE user_id = ? AND symbol = ?`, [
      user.id,
      symbol,
    ]),
    visibleTo(db, user),
  ]);

  const position: PositionView | null = data?.positions.find((p) => p.symbol === symbol) ?? null;
  const quote = quotes.get(symbol);
  const back = (
    <Link
      href={`/${portfolio.slug}/holdings`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {say("Holdings", "持仓")}
    </Link>
  );

  if (!position && !quote) {
    return (
      <div className="space-y-6">
        {back}
        <section className="rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold tracking-tight">
            {say(`Couldn't find ${symbol}`, `找不到 ${symbol}`)}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {say(
              "The broker has no price for it. Check the ticker, or search by the company's name at the top of the page. Shares and funds listed in the US are covered.",
              "券商没有它的报价。请检查代码，或在页面顶部按公司名称搜索。目前支持在美国上市的股票和基金。",
            )}
          </p>
        </section>
      </div>
    );
  }

  const detail = quoteDetail(symbol, quote?.raw);
  const name = (zh && detail.nameZh) || quote?.name || position?.name || detail.name;
  const price = quote?.price ?? position?.currentPrice;
  const change = quote && quote.previousClose ? quote.price - quote.previousClose : undefined;
  const changePercent = quote?.changePercent;

  const practice = visible.find((p) => p.kind === "mock" && p.ownerUserId === user.id);
  const optionsOnIt =
    data?.positions.filter(
      (p) => p.instrumentType === "option" && (p.symbol === symbol || p.underlyingSymbol === symbol),
    ) ?? [];
  const sharePrice = underlying ? quotes.get(underlying)?.price : price;
  const multiplier = position?.instrumentType === "option" ? position.contractMultiplier ?? 100 : 1;
  const paidPerShare =
    position && position.quantity !== 0
      ? Number(position.costBasis.amount) / position.quantity / multiplier
      : undefined;
  const money = (value: number | undefined) =>
    value === undefined || !position
      ? "—"
      : formatMoney({ amount: String(value), currency: position.currency });

  return (
    <div className="space-y-6">
      {back}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{symbol}</h1>
            <Badge>{terms.instrumentType === "option" ? say("option", "期权") : say("stock", "股票")}</Badge>
          </div>
          {name && <p className="mt-0.5 truncate text-sm text-muted-foreground">{name}</p>}
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
            <span className="tabular text-3xl font-semibold tracking-tight">
              {price === undefined ? "—" : `$${price.toFixed(2)}`}
            </span>
            {change !== undefined && changePercent !== undefined && (
              <span className={`tabular text-sm ${signClass(change)}`}>
                {change >= 0 ? "+" : "−"}
                {Math.abs(change).toFixed(2)} ({changePercent >= 0 ? "+" : ""}
                {changePercent.toFixed(2)}%)
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <WatchButton symbol={symbol} watching={Boolean(watched)} />
          {practice && (
            <Link
              href={`/${practice.slug}/trade?symbol=${encodeURIComponent(symbol)}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
            >
              <ShoppingCart className="size-4" aria-hidden="true" />
              {say("Trade in practice", "模拟交易")}
            </Link>
          )}
          <Link
            href={`/${portfolio.slug}/options?symbol=${encodeURIComponent(underlying ?? symbol)}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-muted"
          >
            <Layers className="size-4" aria-hidden="true" />
            {underlying ? say(`Options on ${underlying}`, `${underlying} 的期权`) : say("Options", "期权")}
          </Link>
          <Link
            href="/playground"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-muted"
          >
            <MessagesSquare className="size-4" aria-hidden="true" />
            {say("Discuss", "讨论")}
          </Link>
        </div>
      </header>

      <StockChart
        symbol={symbol}
        portfolioSlug={portfolio.slug}
        initialRange="1M"
        initial={history.length > 0 ? { interval: "day", bars: history } : undefined}
        averageCost={position && terms.instrumentType !== "option" ? paidPerShare : undefined}
      />

      {position && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {say(`Your position in ${portfolio.displayName}`, `你在 ${portfolio.displayName} 的持仓`)}
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">{say("Worth now", "市值")}</p>
              <p className="tabular text-2xl font-semibold tracking-tight">{formatMoney(position.marketValue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{say("Made or lost", "浮动盈亏")}</p>
              <p className={`tabular text-xl font-semibold ${signClass(Number(position.unrealizedPnL.amount))}`}>
                {formatMoney(position.unrealizedPnL, { signed: true })}
              </p>
              <p className={`tabular text-sm ${signClass(Number(position.unrealizedPnL.amount))}`}>
                {formatPercent(position.unrealizedPnLPercent, { signed: true })}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{say("Today", "今日")}</p>
              <p className={`tabular text-xl font-semibold ${signClass(Number(position.todayPnL.amount))}`}>
                {formatMoney(position.todayPnL, { signed: true })}
              </p>
              <p className={`tabular text-sm ${signClass(Number(position.todayPnL.amount))}`}>
                {formatPercent(position.todayPnLPercent, { signed: true })}
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-4">
            {[
              [say("Quantity", "数量"), String(position.quantity)],
              [say("Paid per share", "每股成本"), money(paidPerShare)],
              [say("Cost", "持仓成本"), formatMoney(position.costBasis)],
              [say("Share of account", "占账户比例"), `${position.weightPercent.toFixed(1)}%`],
              ...(position.instrumentType === "option"
                ? [
                    [say("Underlying", "正股"), position.underlyingSymbol ?? "—"],
                    [say("Call or put", "看涨/看跌"), position.optionType === "put" ? say("Put", "看跌") : say("Call", "看涨")],
                    [say("Strike", "行权价"), money(position.strike)],
                    [
                      say("Expires", "到期"),
                      position.expirationDate
                        ? `${position.expirationDate} · ${daysToExpiration(position.expirationDate)}${say("d", "天")}`
                        : "—",
                    ],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="tabular font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {underlying && (
            <Link
              href={`/${portfolio.slug}/holdings/${encodeURIComponent(underlying)}`}
              className="mt-3 inline-block text-sm underline underline-offset-4"
            >
              {say(`Open ${underlying}`, `查看 ${underlying}`)}
            </Link>
          )}
        </section>
      )}

      {/* The journal is about the company, so an option's page writes in
          its underlying's. */}
      <StockNotes symbol={underlying ?? symbol} />

      {optionsOnIt.length > 0 && (
        <PayoffExplorer
          positions={optionsOnIt}
          greeks={data?.optionGreeks}
          underlyingPrices={
            sharePrice === undefined
              ? {}
              : { [underlying ?? symbol]: sharePrice }
          }
        />
      )}

      <MarketPanel detail={detail} price={price} />
    </div>
  );
}
