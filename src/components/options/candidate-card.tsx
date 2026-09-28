"use client";

import Link from "next/link";
import { useState } from "react";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import type { Candidate } from "@/lib/options/strategies";
import { cn } from "@/lib/utils";
import type { PositionView } from "@/types/portfolio";

/**
 * One trade, described the same way wherever it was found: what it is, what
 * you get or pay, where it breaks even, how likely that is, the best and
 * worst case, and for money collected up front the cash it ties up. With its
 * payoff a tap away and a button to try it in a practice account.
 */
export function CandidateCard({
  candidate: c,
  symbol,
  spot,
  expiry,
  days,
  income,
  tradeSlug,
  dimmed = false,
  payoff = true,
}: {
  candidate: Candidate;
  symbol: string;
  spot: number;
  expiry: string;
  /** Shown when the list mixes expiries. */
  days?: number;
  /** Money collected up front, so the cash it ties up is worth showing. */
  income: boolean;
  tradeSlug?: string | null;
  dimmed?: boolean;
  /** Off for a covered call, whose payoff depends on shares this cannot draw. */
  payoff?: boolean;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const [open, setOpen] = useState(false);
  const money = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  const price = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  const words = c.legs
    .map(
      (l) =>
        `${l.side === "buy" ? say("Buy", "买入") : say("Sell", "卖出")} ${l.strike} ${
          l.type === "call" ? say("call", "看涨") : say("put", "看跌")
        }`,
    )
    .join(" · ");

  const positions = c.legs.map((l, index) => ({
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

  return (
    <article className={cn("rounded-xl border border-border bg-surface p-3", dimmed && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{words}</p>
          <p className="tabular text-xs text-muted-foreground">
            {days !== undefined && (
              <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-foreground">
                {expiry.slice(5)} · {days}
                {say("d", "天")}
              </span>
            )}
            {c.legs.map((l) => `${l.strike}${l.type === "call" ? "C" : "P"} ${price(l.price)}`).join(" · ")}
          </p>
        </div>
        <p className={cn("tabular shrink-0 text-right text-sm font-semibold", c.net >= 0 ? "text-positive" : "")}>
          {c.net >= 0 ? say("You get", "收入") : say("You pay", "支出")} {money(Math.abs(c.net) * c.multiplier)}
        </p>
      </div>
      <dl className={cn("mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs", income ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
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
        {income && (
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-muted-foreground">{say("Cash tied up", "占用资金")}</dt>
            <dd className="tabular font-medium">
              {money(c.capital)}
              {c.annualReturn !== null && ` · ${pct(c.annualReturn)} ${say("a year", "每年")}`}
            </dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {payoff && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? say("Hide payoff", "收起盈亏图") : say("See payoff", "看盈亏图")}
          </Button>
        )}
        {tradeSlug &&
          c.legs.map((l) => (
            <Button key={l.symbol} asChild size="sm" variant={c.legs.length > 1 ? "outline" : "primary"}>
              <Link href={`/${tradeSlug}/trade?symbol=${encodeURIComponent(l.symbol)}&side=${l.side}`}>
                {c.legs.length > 1
                  ? `${say("Trade", "交易")} ${l.side === "buy" ? say("the bought", "买入的") : say("the sold", "卖出的")} ${l.strike}`
                  : say("Trade this in practice", "在模拟账户交易")}
              </Link>
            </Button>
          ))}
      </div>
      {open && (
        <div className="mt-3">
          <PayoffExplorer positions={positions} underlyingPrices={{ [symbol]: spot }} hypothetical />
        </div>
      )}
    </article>
  );
}
