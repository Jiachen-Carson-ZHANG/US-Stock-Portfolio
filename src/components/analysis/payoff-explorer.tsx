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
}: {
  positions: PositionView[];
  /** Live share price per underlying, needed to read volatility out of the option's own quote. */
  underlyingPrices?: Record<string, number>;
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

  const pricedLegs: PricedLeg[] = chosen.map((p) => ({
    type: p.optionType!,
    strike: p.strike!,
    quantity: p.quantity,
    multiplier: p.contractMultiplier ?? 100,
    premium: parsedPremium(p),
    vol:
      spot > 0 && years > 0 && (p.currentPrice ?? 0) > 0
        ? impliedVol(p.currentPrice!, p.optionType!, spot, p.strike!, years, RATE)
        : null,
  }));

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
            {say(
              `Today's line assumes ${daysLeft} days still to run and uses the volatility implied by each contract's own market price.`,
              `虚线假设还剩 ${daysLeft} 天，波动率由每张合约自己的市场价格反推得出。`,
            )}
          </>
        )}
      </p>
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
            <span className="text-xs text-muted-foreground">
              {say("Multiplier", "乘数")}: {p.contractMultiplier ?? 100}
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
