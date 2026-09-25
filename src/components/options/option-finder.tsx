"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { SymbolSearch } from "@/components/market/symbol-search";
import { Button } from "@/components/ui/button";
import { Help } from "@/components/ui/help";
import { useLocale } from "@/lib/i18n/context";
import type { Candidate, StrategyKey } from "@/lib/options/strategies";
import { cn } from "@/lib/utils";
import type { OptionExpiration } from "@/types/market";
import type { PositionView } from "@/types/portfolio";

type Answer = {
  symbol: string;
  spot: number;
  expirations: OptionExpiration[];
  candidates?: Candidate[];
  priced?: number;
  error?: string;
  reason?: string;
};

/**
 * The strategies, by what somebody wants rather than what they are called.
 * The jargon name is kept underneath, because it is what every other app and
 * article uses, and knowing it is how somebody learns more.
 */
const STRATEGY: Record<StrategyKey, { en: [string, string, string]; zh: [string, string, string]; income: boolean }> = {
  "sell-put": {
    en: ["Get paid to wait for a lower price", "Sell a put", "Collect money now. If the share falls below the strike you buy it there — so pick a share and a price you would be glad to own."],
    zh: ["等更低的价格买入，先收一笔钱", "卖出看跌期权", "现在就收钱。如果股价跌破行权价，你要按行权价买入——所以要选你本来就愿意在那个价位持有的股票。"],
    income: true,
  },
  "covered-call": {
    en: ["Earn on shares you already own", "Covered call", "For every 100 shares you hold, sell a call above today's price. You keep the money; if the share rises past the strike, your shares are sold there."],
    zh: ["用已持有的股票赚额外收入", "备兑看涨", "每持有 100 股，卖出一张高于现价的看涨期权。收到的钱归你；如果股价涨过行权价，股票会按行权价被卖出。"],
    income: true,
  },
  "bull-put-spread": {
    en: ["Get paid if it stays above a price", "Bull put spread", "Sell a put and buy a cheaper one below it. You collect money now, and the second put caps how much you can lose."],
    zh: ["只要股价守在某个价位之上就赚钱", "牛市看跌价差", "卖出一张看跌期权，再买入一张更低行权价的看跌期权。现在收钱，第二张期权限定了最大亏损。"],
    income: true,
  },
  "bear-call-spread": {
    en: ["Get paid if it stays below a price", "Bear call spread", "Sell a call and buy a cheaper one above it. You collect money now, and the second call caps how much you can lose."],
    zh: ["只要股价不涨过某个价位就赚钱", "熊市看涨价差", "卖出一张看涨期权，再买入一张更高行权价的看涨期权。现在收钱，第二张期权限定了最大亏损。"],
    income: true,
  },
  "buy-call": {
    en: ["Bet it goes up", "Buy a call", "The most you can lose is what you pay. The share has to rise past the break-even before expiry for it to make money."],
    zh: ["押注上涨", "买入看涨期权", "最多亏掉付出的钱。到期前股价要涨过保本价才赚钱。"],
    income: false,
  },
  "buy-put": {
    en: ["Bet it goes down, or protect shares", "Buy a put", "The most you can lose is what you pay. It gains as the share falls below the break-even — also used as insurance on shares you hold."],
    zh: ["押注下跌，或给持股买保险", "买入看跌期权", "最多亏掉付出的钱。股价跌破保本价时开始赚钱——也可以当作持股的保险。"],
    income: false,
  },
  "bull-call-spread": {
    en: ["Bet it goes up, for less", "Bull call spread", "Buy a call and sell a higher one. Cheaper than a call alone, in exchange for a ceiling on what it can make."],
    zh: ["押注上涨，但花得更少", "牛市看涨价差", "买入一张看涨期权，同时卖出一张更高行权价的。比单买看涨便宜，代价是收益有上限。"],
    income: false,
  },
  "bear-put-spread": {
    en: ["Bet it goes down, for less", "Bear put spread", "Buy a put and sell a lower one. Cheaper than a put alone, in exchange for a ceiling on what it can make."],
    zh: ["押注下跌，但花得更少", "熊市看跌价差", "买入一张看跌期权，同时卖出一张更低行权价的。比单买看跌便宜，代价是收益有上限。"],
    income: false,
  },
};

const ORDER: StrategyKey[] = [
  "sell-put", "covered-call", "bull-put-spread", "bear-call-spread",
  "buy-call", "buy-put", "bull-call-spread", "bear-put-spread",
];

/**
 * Finding an option to trade, by what you want to happen.
 *
 * A pop-up rather than another section, because it answers a different
 * question from the option analysis on the page behind it: that one is about
 * what you hold; this is about what you could. Each result can be opened in
 * the same analysis — the same chart, the same break-even — so the two read
 * as one tool, and a single-contract result goes straight to the ticket.
 */
export function OptionFinder({
  portfolioSlug,
  initialSymbol = "",
  tradeSlug,
  label,
}: {
  /** Whose broker connection prices the chain. */
  portfolioSlug: string;
  initialSymbol?: string;
  /** A practice account the viewer can trade in, if they have one. */
  tradeSlug?: string | null;
  label?: string;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const dialog = useRef<HTMLDialogElement>(null);

  const [symbol, setSymbol] = useState(initialSymbol);
  const [strategy, setStrategy] = useState<StrategyKey>("sell-put");
  const [expiry, setExpiry] = useState<string | null>(null);
  const [sure, setSure] = useState(0.7);
  const [base, setBase] = useState<Answer | null>(null);
  const [result, setResult] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const ticker = symbol.trim().toUpperCase();

  // The share's price and its listed expiries, once a ticker settles.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(ticker)) {
        setBase(null);
        return;
      }
      void fetch(
        `/api/options/screen?portfolio=${encodeURIComponent(portfolioSlug)}&symbol=${encodeURIComponent(ticker)}`,
      )
        .then((response) => response.json())
        .then((body: Answer) => {
          if (cancelled) return;
          setBase(body);
          // Three weeks out or more by default: the nearest weekly is mostly
          // a coin toss with a fee attached.
          const listed = body.expirations ?? [];
          setExpiry((current) =>
            current && listed.some((row) => row.date === current)
              ? current
              : (listed.find((row) => row.days >= 20) ?? listed[0])?.date ?? null,
          );
        })
        .catch(() => {
          if (!cancelled) setBase({ symbol: ticker, spot: 0, expirations: [], error: "offline" });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticker, portfolioSlug]);

  // The candidates, whenever what is asked for changes.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!base?.spot || !expiry) {
        setResult(null);
        return;
      }
      setLoading(true);
      setOpen(null);
      void fetch(
        `/api/options/screen?portfolio=${encodeURIComponent(portfolioSlug)}&symbol=${encodeURIComponent(base.symbol)}&expiry=${expiry}&strategy=${strategy}&sure=${sure}`,
      )
        .then((response) => response.json())
        .then((body: Answer) => {
          if (!cancelled) setResult(body);
        })
        .catch(() => {
          if (!cancelled) setResult({ symbol: base.symbol, spot: base.spot, expirations: [], error: "offline" });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base, expiry, strategy, sure, portfolioSlug]);

  const money = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  const price = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const info = STRATEGY[strategy];
  const words = zh ? info.zh : info.en;
  const spot = result?.spot ?? base?.spot ?? 0;
  const days = base?.expirations.find((row) => row.date === expiry)?.days ?? 0;

  const legWords = (c: Candidate) =>
    c.legs
      .map(
        (l) =>
          `${l.side === "buy" ? say("Buy", "买入") : say("Sell", "卖出")} ${l.strike} ${
            l.type === "call" ? say("call", "看涨") : say("put", "看跌")
          }`,
      )
      .join(" · ");

  /** The candidate as positions, so the ordinary option analysis can draw it. */
  const asPositions = (c: Candidate): PositionView[] =>
    c.legs.map((l, index) => ({
      id: `${l.symbol}-${index}`,
      symbol: l.symbol,
      instrumentType: "option",
      optionType: l.type,
      strike: l.strike,
      underlyingSymbol: result?.symbol ?? base?.symbol,
      expirationDate: expiry,
      currency: "USD",
      quantity: l.side === "buy" ? 1 : -1,
      averageCost: l.price,
      currentPrice: l.price,
      contractMultiplier: c.multiplier,
    })) as unknown as PositionView[];

  return (
    <>
      <Button variant="outline" onClick={() => dialog.current?.showModal()}>
        <Search className="size-4" aria-hidden="true" />
        <span className="ml-1.5">{label ?? say("Find an option", "查找期权")}</span>
      </Button>

      <dialog
        ref={dialog}
        aria-label={say("Find an option", "查找期权")}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-border"
      >
        <div className="flex h-full flex-col sm:max-h-[90dvh]">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
            <h2 className="flex items-center gap-1 font-medium">
              {say("Find an option", "查找期权")}
              <Help title={say("How this works", "这是怎么用的")}>
                {say(
                  "Pick a share, what you want to happen, and when. The list shows real contracts on that date, priced as you would actually trade them — a sale at the bid, a purchase at the ask — with what each can make and lose, where it breaks even, and the chance of profit. That chance is what today's option prices imply, not a forecast, and it assumes you hold to expiry. One contract is 100 shares; every amount here is for one set of contracts.",
                  "选一只股票、你希望发生的走势，以及到期时间。列表里是那一天真实存在的合约，按你实际能成交的价格计算——卖出按买一价，买入按卖一价——并列出每个方案最多赚多少、最多亏多少、保本价和盈利概率。这个概率是由当前期权价格推算出来的，不是预测，并假设持有到期。一张合约是 100 股；这里所有金额都按一组合约计算。",
                )}
              </Help>
            </h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label={say("Close", "关闭")}
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block text-xs text-muted-foreground" htmlFor="finder-symbol">
                {say("Share or fund", "股票或基金")}
                <SymbolSearch
                  id="finder-symbol"
                  className="mt-1.5"
                  value={symbol}
                  onChange={(value) => setSymbol(value.toUpperCase())}
                  placeholder={say("e.g. NVDA or Micron", "例如 NVDA 或 Micron")}
                />
              </label>
              {base?.spot ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">{say("Now", "现价")}</span>{" "}
                  <span className="tabular font-semibold">{price(base.spot)}</span>
                </p>
              ) : null}
            </div>

            <fieldset>
              <legend className="text-xs text-muted-foreground">
                {say("What do you want to happen?", "你希望发生什么？")}
              </legend>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {ORDER.map((key) => {
                  const [title, name] = zh ? STRATEGY[key].zh : STRATEGY[key].en;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={strategy === key}
                      onClick={() => setStrategy(key)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition-colors",
                        strategy === key ? "border-accent bg-accent/5" : "border-border hover:bg-muted",
                      )}
                    >
                      <span className="block text-[13px] font-medium leading-snug sm:text-sm">{title}</span>
                      <span className="block text-xs text-muted-foreground">{name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{words[2]}</p>
            </fieldset>

            {base && base.expirations.length > 0 && (
              <fieldset>
                <legend className="text-xs text-muted-foreground">{say("Expiry", "到期日")}</legend>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {base.expirations.slice(0, 12).map((row) => (
                    <button
                      key={row.date}
                      type="button"
                      aria-pressed={expiry === row.date}
                      onClick={() => setExpiry(row.date)}
                      className={cn(
                        "min-h-9 rounded-lg border px-2.5 text-xs",
                        expiry === row.date ? "border-accent bg-accent/5 font-medium" : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {row.date.slice(5)} · {row.days}
                      {say("d", "天")}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {info.income && (
              <fieldset>
                <legend className="flex items-center gap-1 text-xs text-muted-foreground">
                  {say("How sure do you want to be?", "你希望有多大把握？")}
                  <Help title={say("How sure", "把握多大")}>
                    {say(
                      "The least chance, by today's option prices, that you keep the money. More certain means less income: the market pays more for taking more risk. The list only shows contracts at least this likely to end in profit.",
                      "按当前期权价格推算，你能保住这笔钱的最低概率。把握越大，收入越少：市场只会为更高的风险付更多的钱。列表只显示达到这个盈利概率的合约。",
                    )}
                  </Help>
                </legend>
                <div className="mt-1.5 flex gap-1.5">
                  {[
                    [0.8, say("80% · safer", "80% · 更稳")],
                    [0.7, say("70% · balanced", "70% · 平衡")],
                    [0.6, say("60% · more income", "60% · 收入更高")],
                  ].map(([value, text]) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={sure === value}
                      onClick={() => setSure(Number(value))}
                      className={cn(
                        "min-h-9 rounded-lg border px-2.5 text-xs",
                        sure === value ? "border-accent bg-accent/5 font-medium" : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <section aria-live="polite" className="space-y-2">
              {!base ? (
                <p className="text-sm text-muted-foreground">
                  {say("Start with a share or fund above.", "先在上面选一只股票或基金。")}
                </p>
              ) : base.error ? (
                <p className="text-sm text-negative">
                  {base.error === "offline" ? say("Could not reach the site. Check your connection.", "连不上网站，请检查网络。") : base.error}
                </p>
              ) : base.expirations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {say(`No options are listed on ${base.symbol}.`, `${base.symbol} 没有上市的期权。`)}
                </p>
              ) : loading && !result ? (
                <p className="text-sm text-muted-foreground">{say("Pricing the chain…", "正在给期权链报价…")}</p>
              ) : result?.error ? (
                <p className="text-sm text-negative">
                  {result.error === "offline" ? say("Could not reach the site.", "连不上网站。") : result.error} {result.reason}
                </p>
              ) : result?.candidates && result.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {info.income
                    ? say("Nothing on this date is that likely to pay. Try less certainty, or a later date.", "这一天没有达到这个把握的合约。可以降低把握，或换一个更晚的日期。")
                    : say("No contracts on this date have a usable price right now.", "这一天的合约现在都没有可用的报价。")}
                </p>
              ) : (
                result?.candidates?.map((c, index) => (
                  <article key={c.legs.map((l) => l.symbol).join("+")} className={cn("rounded-xl border border-border p-3", loading && "opacity-60")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{legWords(c)}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {c.legs.map((l) => `${l.strike}${l.type === "call" ? "C" : "P"} ${price(l.price)}`).join(" · ")}
                        </p>
                      </div>
                      <p className={cn("tabular shrink-0 text-right text-sm font-semibold", c.net >= 0 ? "text-positive" : "")}>
                        {c.net >= 0 ? say("You get", "收入") : say("You pay", "支出")}{" "}
                        {money(Math.abs(c.net) * c.multiplier)}
                      </p>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">{say("Break-even", "保本价")}</dt>
                        <dd className="tabular font-medium">
                          {price(c.breakEven)}{" "}
                          <span className="text-muted-foreground">
                            ({c.breakEven >= spot ? "+" : "−"}
                            {(Math.abs(c.breakEven / spot - 1) * 100).toFixed(1)}%)
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{say("Chance of profit", "盈利概率")}</dt>
                        <dd className="tabular font-medium">{c.chance === null ? "—" : pct(c.chance)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{say("Best case", "最多赚")}</dt>
                        <dd className="tabular font-medium text-positive">
                          {c.maxProfit === null ? say("No limit", "无上限") : `+${money(c.maxProfit)}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{say("Worst case", "最多亏")}</dt>
                        <dd className="tabular font-medium text-negative">
                          {c.maxLoss === null ? say("No limit", "无上限") : `−${money(c.maxLoss)}`}
                        </dd>
                      </div>
                      {info.income && (
                        <div className="col-span-2">
                          <dt className="text-muted-foreground">{say("Cash it ties up · per year", "占用资金 · 年化")}</dt>
                          <dd className="tabular font-medium">
                            {money(c.capital)}
                            {c.annualReturn !== null && ` · ${pct(c.annualReturn)} ${say("a year", "每年")}`}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {strategy !== "covered-call" && (
                        <button
                          type="button"
                          onClick={() => setOpen(open === index ? null : index)}
                          aria-expanded={open === index}
                          className="underline underline-offset-4"
                        >
                          {open === index ? say("Hide payoff", "收起盈亏图") : say("See payoff", "看盈亏图")}
                        </button>
                      )}
                      {tradeSlug &&
                        c.legs.map((l) => (
                          <Link
                            key={l.symbol}
                            href={`/${tradeSlug}/trade?symbol=${encodeURIComponent(l.symbol)}&side=${l.side}`}
                            className="underline underline-offset-4"
                            onClick={() => dialog.current?.close()}
                          >
                            {c.legs.length > 1
                              ? `${say("Trade", "交易")} ${l.side === "buy" ? say("the bought", "买入的") : say("the sold", "卖出的")} ${l.strike}`
                              : say("Trade this in practice", "在模拟账户交易")}
                          </Link>
                        ))}
                    </div>
                    {open === index && (
                      <div className="mt-3">
                        <PayoffExplorer
                          positions={asPositions(c)}
                          underlyingPrices={{ [result?.symbol ?? ""]: spot }}
                        />
                      </div>
                    )}
                  </article>
                ))
              )}
              {result?.candidates && result.candidates.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {say(
                    `${days} days to expiry. Prices from ${result.priced ?? 0} contracts nearest today's price; ranked ${
                      info.income ? "by income per year, among those at least as likely to pay as asked" : "nearest today's price first"
                    }.`,
                    `距到期 ${days} 天。报价来自最接近现价的 ${result.priced ?? 0} 张合约；${
                      info.income ? "在达到所选把握的合约中，按年化收入排序" : "按行权价离现价由近到远排序"
                    }。`,
                  )}
                </p>
              )}
            </section>
          </div>
        </div>
      </dialog>
    </>
  );
}
