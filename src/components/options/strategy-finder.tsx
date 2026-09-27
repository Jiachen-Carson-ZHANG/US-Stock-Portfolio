"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { Help } from "@/components/ui/help";
import { Input } from "@/components/ui/field";
import { useLocale } from "@/lib/i18n/context";
import type { Candidate, StrategyKey } from "@/lib/options/strategies";
import { cn } from "@/lib/utils";
import type { OptionExpiration } from "@/types/market";
import type { PositionView } from "@/types/portfolio";
import { ORDER, STRATEGY } from "./strategy-text";

type Answer = { candidates?: Candidate[]; priced?: number; error?: string; reason?: string };

/**
 * Searching every contract on a date for the ones that fit a goal.
 *
 * Separate from the chain on purpose: the chain is for looking at contracts;
 * this goes through all of them and ranks the ones that suit what you want.
 * The everyday choices are plain fields — what you want, when, and
 * optionally a range of strikes — and the one setting that needs explaining,
 * how sure you want to be of keeping the money, sits under "More options"
 * with the explanation beside it.
 */
export function StrategyFinder({
  portfolioSlug,
  symbol,
  spot,
  expirations,
  tradeSlug,
}: {
  portfolioSlug: string;
  symbol: string;
  spot: number;
  expirations: OptionExpiration[];
  tradeSlug?: string | null;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const [strategy, setStrategy] = useState<StrategyKey>("sell-put");
  const [expiry, setExpiry] = useState<string>(
    (expirations.find((row) => row.days >= 20) ?? expirations[0])?.date ?? "",
  );
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [sure, setSure] = useState(0.7);
  const [result, setResult] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const info = STRATEGY[strategy];
  const [, name, explanation] = zh ? info.zh : info.en;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!expiry) return;
      setLoading(true);
      setOpen(null);
      const range = [
        Number(min) > 0 ? `&min=${Number(min)}` : "",
        Number(max) > 0 ? `&max=${Number(max)}` : "",
      ].join("");
      void fetch(
        `/api/options/screen?portfolio=${encodeURIComponent(portfolioSlug)}&symbol=${encodeURIComponent(symbol)}&expiry=${expiry}&strategy=${strategy}&sure=${sure}${range}`,
      )
        .then((response) => response.json())
        .then((body: Answer) => {
          if (!cancelled) setResult(body);
        })
        .catch(() => {
          if (!cancelled) setResult({ error: "offline" });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [portfolioSlug, symbol, expiry, strategy, sure, min, max]);

  const money = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  const price = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const days = expirations.find((row) => row.date === expiry)?.days ?? 0;

  const legWords = (c: Candidate) =>
    c.legs
      .map(
        (l) =>
          `${l.side === "buy" ? say("Buy", "买入") : say("Sell", "卖出")} ${l.strike} ${
            l.type === "call" ? say("call", "看涨") : say("put", "看跌")
          }`,
      )
      .join(" · ");

  const asPositions = (c: Candidate): PositionView[] =>
    c.legs.map((l, index) => ({
      id: `${l.symbol}-${index}`,
      symbol: l.symbol,
      instrumentType: "option",
      optionType: l.type,
      strike: l.strike,
      underlyingSymbol: symbol,
      expirationDate: expiry,
      currency: "USD",
      quantity: l.side === "buy" ? 1 : -1,
      averageCost: l.price,
      currentPrice: l.price,
      contractMultiplier: c.multiplier,
    })) as unknown as PositionView[];

  const field = "min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {say("What do you want?", "你想要什么？")}
            <Help title={say("The goals", "各个目标")}>
              {ORDER.map((key) => {
                const [title, jargon, why] = zh ? STRATEGY[key].zh : STRATEGY[key].en;
                return (
                  <span key={key} className="mb-2 block">
                    <strong className="font-medium text-foreground">{title}</strong> ({jargon}) — {why}
                  </span>
                );
              })}
            </Help>
          </span>
          <select
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as StrategyKey)}
            className={cn(field, "mt-1.5")}
          >
            {ORDER.map((key) => (
              <option key={key} value={key}>
                {(zh ? STRATEGY[key].zh : STRATEGY[key].en)[0]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-muted-foreground">
          {say("Expiry", "到期日")}
          <select value={expiry} onChange={(event) => setExpiry(event.target.value)} className={cn(field, "mt-1.5")}>
            {expirations.map((row) => (
              <option key={row.date} value={row.date}>
                {row.date} · {row.days} {say("days", "天")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="text-xs text-muted-foreground">
          {say("Strikes between (optional)", "行权价范围（可选）")}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <Input inputMode="decimal" placeholder={say("from", "从")} value={min} onChange={(event) => setMin(event.target.value)} />
          <span className="text-muted-foreground">–</span>
          <Input inputMode="decimal" placeholder={say("to", "到")} value={max} onChange={(event) => setMax(event.target.value)} />
        </div>
      </div>

      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{name}.</span> {explanation}
      </p>

      {info.income && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">{say("More options", "更多选项")}</summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {say(
                "Only show trades at least this likely to keep the money — judged from today's option prices, assuming you hold to expiry. Asking for more certainty means less income: the market pays more for more risk.",
                "只显示至少有这么大把握能保住这笔钱的交易——按今天的期权价格推算，并假设持有到期。要求的把握越大，收入就越少：市场只为更高的风险付更多的钱。",
              )}
            </p>
            <div className="flex gap-1.5">
              {[0.8, 0.7, 0.6].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sure === value}
                  onClick={() => setSure(value)}
                  className={cn(
                    "min-h-9 rounded-lg border px-3 text-xs",
                    sure === value ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {pct(value)}
                </button>
              ))}
            </div>
          </div>
        </details>
      )}

      <section aria-live="polite" className="space-y-2">
        {loading && !result ? (
          <p className="text-sm text-muted-foreground">{say("Searching the chain…", "正在搜索期权链…")}</p>
        ) : result?.error ? (
          <p className="text-sm text-negative">
            {result.error === "offline" ? say("Could not reach the site.", "连不上网站。") : result.error} {result.reason}
          </p>
        ) : result?.candidates && result.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {info.income
              ? say("Nothing on this date fits. Try a later date, a wider strike range, or less certainty under More options.", "这一天没有合适的。可以换更晚的日期、放宽行权价范围，或在「更多选项」里降低把握。")
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
                  {c.net >= 0 ? say("You get", "收入") : say("You pay", "支出")} {money(Math.abs(c.net) * c.multiplier)}
                </p>
              </div>
              <dl className={cn("mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs", info.income ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
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
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="text-muted-foreground">{say("Cash tied up", "占用资金")}</dt>
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
                    >
                      {c.legs.length > 1
                        ? `${say("Trade", "交易")} ${l.side === "buy" ? say("the bought", "买入的") : say("the sold", "卖出的")} ${l.strike}`
                        : say("Trade this in practice", "在模拟账户交易")}
                    </Link>
                  ))}
              </div>
              {open === index && (
                <div className="mt-3">
                  <PayoffExplorer positions={asPositions(c)} underlyingPrices={{ [symbol]: spot }} hypothetical />
                </div>
              )}
            </article>
          ))
        )}
        {result?.candidates && result.candidates.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {say(
              `${days} days to expiry · ${result.priced ?? 0} contracts priced · ranked ${
                info.income ? "by income per year, among those at least as likely to pay as chosen" : "nearest today's price first"
              }`,
              `距到期 ${days} 天 · 已报价 ${result.priced ?? 0} 张合约 · ${
                info.income ? "在达到所选把握的合约中按年化收入排序" : "按行权价离现价由近到远排序"
              }`,
            )}
          </p>
        )}
      </section>
    </div>
  );
}
