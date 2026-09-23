"use client";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useLocale } from "@/lib/i18n/context";
import {
  ChartFrame,
  GRID,
  AXIS_TICK,
  seriesColor,
} from "@/components/charts/chart-kit";
import { Input } from "@/components/ui/field";
import { expirationPayoff } from "@/lib/analysis/math";
import {
  impliedVol,
  valueToday,
  yearsUntil,
  type PricedLeg,
} from "@/lib/analysis/options-pricing";
import type { OptionGreeks } from "@/types/market";
import type { PositionView } from "@/types/portfolio";

/**
 * A stand-in for the risk-free rate. It moves the answer by cents on a
 * three-month option and is not worth a data feed of its own; when it starts
 * to matter, it becomes an input.
 */
const RATE = 0.04;

export function PayoffExplorer({
  positions,
  underlyingPrices = {},
  greeks = {},
}: {
  positions: PositionView[];
  /** Live share price per underlying, needed to price the contracts. */
  underlyingPrices?: Record<string, number>;
  /**
   * The broker's own risk figures per contract. Preferred over anything
   * derived here: the market quoted the price with these numbers, so using
   * them keeps this screen and the broker's app telling the same story.
   */
  greeks?: Record<string, OptionGreeks>;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const options = positions.filter(
    (p) =>
      p.instrumentType === "option" &&
      p.strike !== undefined &&
      p.optionType &&
      p.underlyingSymbol &&
      p.expirationDate,
  );
  const keys = [
    ...new Set(
      options.map(
        (p) => `${p.underlyingSymbol}|${p.expirationDate}|${p.currency}`,
      ),
    ),
  ];
  const [group, setGroup] = useState(keys[0] ?? "");
  const [premiums, setPremiums] = useState<Record<string, string>>({});
  const [fees, setFees] = useState("0");
  const [price, setPrice] = useState<number | null>(null);
  if (!keys.length) return null;
  const chosen = options.filter(
    (p) => `${p.underlyingSymbol}|${p.expirationDate}|${p.currency}` === group,
  );
  const anchor = Math.max(...chosen.map((p) => p.strike!));
  const scenario = price ?? anchor;
  const parsedPremium = (p: PositionView) =>
    Number(premiums[p.id] ?? String(Math.max(0, p.averageCost ?? 0)));
  const valid =
    chosen.every(
      (p) =>
        (premiums[p.id] ?? String(p.averageCost ?? "")).trim() !== "" &&
        Number.isFinite(parsedPremium(p)) &&
        parsedPremium(p) >= 0 &&
        Number.isFinite(p.quantity) &&
        Number.isFinite(p.contractMultiplier ?? 100) &&
        (p.contractMultiplier ?? 100) > 0,
    ) &&
    fees.trim() !== "" &&
    Number.isFinite(Number(fees)) &&
    Number(fees) >= 0;
  const legs = chosen.map((p) => ({
    type: p.optionType!,
    strike: p.strike!,
    premium: parsedPremium(p),
    quantity: p.quantity,
    multiplier: p.contractMultiplier ?? 100,
  }));
  /**
   * The same position valued as it stands today, with the time it still has.
   *
   * Each leg's volatility is solved from its own current market price, so the
   * curve passes through what the position is actually marked at rather than
   * through a number somebody guessed. If any leg cannot be inverted — no
   * trade today, a crossed quote — the whole "today" line is dropped instead
   * of being drawn from a mixture of real and invented volatilities.
   */
  const spot = underlyingPrices[chosen[0]?.underlyingSymbol ?? ""] ?? 0;
  const years = yearsUntil(chosen[0]?.expirationDate ?? "");

  /**
   * Volatility per leg, the broker's figure first.
   *
   * moomoo publishes implied volatility alongside the price, which is the
   * number the contract was actually quoted with. Falling back to solving it
   * out of the price is a good reconstruction of the same quantity, and is
   * what happens when the feed omits it — but it is a reconstruction, so the
   * screen says which one it used.
   */
  const pricedLegs: PricedLeg[] = chosen.map((p) => {
    const published = greeks[p.symbol]?.impliedVolatility;
    const usable = published !== undefined && published > 0 ? published : null;

    return {
      type: p.optionType!,
      strike: p.strike!,
      quantity: p.quantity,
      multiplier: p.contractMultiplier ?? 100,
      premium: parsedPremium(p),
      vol:
        usable ??
        (spot > 0 && years > 0 && (p.currentPrice ?? 0) > 0
          ? impliedVol(p.currentPrice!, p.optionType!, spot, p.strike!, years, RATE)
          : null),
    };
  });

  const fromBroker = chosen.some(
    (p) => (greeks[p.symbol]?.impliedVolatility ?? 0) > 0,
  );

  /**
   * The position's overall sensitivity, added up across the legs.
   *
   * Delta is how many shares this behaves like: a spread at +0.30 delta on
   * two contracts moves like 60 shares, so a dollar on the share is about
   * sixty dollars here. Theta is what one day of waiting costs, which is the
   * number people are most surprised by and the reason an option left alone
   * quietly shrinks.
   */
  const totals = chosen.reduce(
    (sum, p) => {
      const g = greeks[p.symbol];
      const units = p.quantity * (p.contractMultiplier ?? 100);
      return {
        delta: sum.delta + (g?.delta ?? 0) * units,
        theta: sum.theta + (g?.theta ?? 0) * units,
        any: sum.any || g?.delta !== undefined || g?.theta !== undefined,
      };
    },
    { delta: 0, theta: 0, any: false },
  );

  const hasToday =
    valid && spot > 0 && years > 0 && pricedLegs.every((leg) => leg.vol !== null);

  const curve = valid
    ? Array.from({ length: 61 }, (_, i) => {
        const at = (anchor * 2 * i) / 60;
        return {
          price: at,
          pnl: expirationPayoff(legs, at, Number(fees)),
          today: hasToday ? valueToday(pricedLegs, at, years, RATE, Number(fees)) : null,
        };
      })
    : [];

  const todayNow = hasToday
    ? valueToday(pricedLegs, scenario, years, RATE, Number(fees))
    : null;
  const daysLeft = Math.round(years * 365.25);
  const money = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", {
      style: "currency",
      currency: chosen[0]?.currency ?? "USD",
    }).format(n);
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-medium">
        {say("What this option position would be worth", "这组期权会值多少钱")}
      </h2>
      <p className="text-xs text-muted-foreground">
        {say(
          "Two lines, and the difference between them is the point. The solid one is what you keep if you hold to the last day. The dashed one is what you could sell for today at that share price, which is higher wherever there is still time left — an option that has not expired is worth more than what it would pay out right now, and selling early gets that extra back.",
          "两条线，它们之间的差距才是重点。实线是持有到最后一天你能拿到的钱。虚线是在那个股价下今天就卖掉能拿到的钱；只要还有时间没走完，虚线就更高——没到期的期权，价值高于它现在能兑现的金额，提前卖出就能把这部分拿回来。",
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {say(
          "Only legs sharing an underlying, expiry and currency are combined. Premiums start from broker cost and can be corrected. Held to expiry; no early assignment, no tax.",
          "仅合并相同标的、到期日和币种的期权。权利金默认取券商成本，可自行修改。假设持有到期，不考虑提前行权与税费。",
        )}
        {hasToday && (
          <>
            {" "}
            {fromBroker
              ? say(
                  `Today's line assumes ${daysLeft} days still to run and uses the implied volatility the broker publishes with each contract's price.`,
                  `虚线假设还剩 ${daysLeft} 天，隐含波动率取自券商随价格一并发布的数据。`,
                )
              : say(
                  `Today's line assumes ${daysLeft} days still to run. The broker did not publish an implied volatility for these contracts, so it was worked back out of each one's own market price instead.`,
                  `虚线假设还剩 ${daysLeft} 天。券商未提供这些合约的隐含波动率，因此由每张合约自己的市场价格反推得出。`,
                )}
          </>
        )}
      </p>

      {totals.any && (
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">
              {say("Moves like this many shares", "相当于持有多少股")}
            </dt>
            <dd className="tabular mt-0.5 text-sm font-medium">
              {totals.delta.toFixed(0)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {say("A dollar on the share is worth", "正股每涨 1 美元")}
            </dt>
            <dd className="tabular mt-0.5 text-sm font-medium">
              {money(totals.delta)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {say("One day of waiting costs", "每过一天的损耗")}
            </dt>
            <dd
              className={`tabular mt-0.5 text-sm font-medium ${totals.theta < 0 ? "text-negative" : "text-positive"}`}
            >
              {money(totals.theta)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {say("Days to expiry", "剩余天数")}
            </dt>
            <dd className="tabular mt-0.5 text-sm font-medium">{daysLeft}</dd>
          </div>
        </dl>
      )}
      <label className="block text-sm">
        {say("Position group", "持仓组合")}
        <select
          className="mt-1 block w-full rounded-lg border border-border bg-surface p-2"
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            setPrice(null);
          }}
        >
          {keys.map((key) => (
            <option key={key} value={key}>
              {key.replaceAll("|", " · ")}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {chosen.map((p) => (
          <label key={p.id} className="text-sm">
            {p.quantity} × {p.strike} {p.optionType} ·{" "}
            {say("premium / share", "每股权利金")}
            <Input
              type="number"
              min="0"
              step="0.01"
              value={premiums[p.id] ?? String(Math.max(0, p.averageCost ?? 0))}
              onChange={(e) =>
                setPremiums({ ...premiums, [p.id]: e.target.value })
              }
            />
            <span className="block text-xs text-muted-foreground">
              {say("Multiplier", "乘数")}: {p.contractMultiplier ?? 100}
              {greeks[p.symbol]?.impliedVolatility !== undefined && (
                <>
                  {" · "}
                  {say("Volatility", "波动率")}{" "}
                  {(greeks[p.symbol]!.impliedVolatility! * 100).toFixed(1)}%
                </>
              )}
              {greeks[p.symbol]?.delta !== undefined && (
                <>
                  {" · "}
                  {say("Delta", "Delta")} {greeks[p.symbol]!.delta!.toFixed(3)}
                </>
              )}
              {greeks[p.symbol]?.theta !== undefined && (
                <>
                  {" · "}
                  {say("Theta", "Theta")} {greeks[p.symbol]!.theta!.toFixed(3)}
                </>
              )}
            </span>
          </label>
        ))}
      </div>
      <label className="block text-sm">
        {say("Total scenario fees", "情景总费用")}
        <Input
          type="number"
          min="0"
          step="0.01"
          value={fees}
          onChange={(e) => setFees(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        {say("Share price in this scenario", "假设的正股价格")}:{" "}
        <strong>{money(scenario)}</strong>
        <input
          className="mt-3 block w-full accent-[var(--accent)]"
          type="range"
          min="0"
          max={anchor * 2}
          step="0.01"
          value={scenario}
          onChange={(e) => setPrice(Number(e.target.value))}
        />
      </label>
      {valid ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">
              {say("If held to expiry", "持有到期")}
            </p>
            <output
              className={`block text-2xl font-semibold ${expirationPayoff(legs, scenario, Number(fees)) < 0 ? "text-negative" : "text-positive"}`}
            >
              {money(expirationPayoff(legs, scenario, Number(fees)))}
            </output>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {say("If sold today at that price", "在那个股价下今天卖出")}
            </p>
            <output
              className={`block text-2xl font-semibold ${todayNow === null ? "text-muted-foreground" : todayNow < 0 ? "text-negative" : "text-positive"}`}
            >
              {todayNow === null
                ? say("No usable option quote", "缺少可用的期权报价")
                : money(todayNow)}
            </output>
          </div>
        </div>
      ) : (
        <output className="block text-sm text-muted-foreground">
          {say("Enter valid premiums and fees", "请输入有效的权利金和费用")}
        </output>
      )}
      {valid && (
        <ChartFrame title={say("Profit or loss at each share price", "不同股价下的盈亏")}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                type="number"
                dataKey="price"
                domain={[0, anchor * 2]}
                tick={AXIS_TICK}
                tickFormatter={(n) => Number(n).toFixed(0)}
              />
              <YAxis tick={AXIS_TICK} width={75} />
              <Tooltip
                formatter={(v) => money(Number(v))}
                labelFormatter={(v) => money(Number(v))}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" />
              <ReferenceLine
                x={scenario}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
              />
              <Line
                dataKey="pnl"
                name={say("Held to expiry", "持有到期")}
                type="linear"
                stroke={seriesColor(0)}
                dot={false}
                isAnimationActive={false}
              />
              {hasToday && (
                <Line
                  dataKey="today"
                  name={say("Sold today", "今天卖出")}
                  type="monotone"
                  stroke={seriesColor(1)}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}
    </section>
  );
}
