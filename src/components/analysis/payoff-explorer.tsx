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
import type { PositionView } from "@/types/portfolio";

export function PayoffExplorer({ positions }: { positions: PositionView[] }) {
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
  const curve = valid
    ? Array.from({ length: 61 }, (_, i) => ({
        price: (anchor * 2 * i) / 60,
        pnl: expirationPayoff(legs, (anchor * 2 * i) / 60, Number(fees)),
      }))
    : [];
  const money = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", {
      style: "currency",
      currency: chosen[0]?.currency ?? "USD",
    }).format(n);
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-medium">
        {say("Options payoff explorer", "期权到期盈亏探索")}
      </h2>
      <p className="text-xs text-muted-foreground">
        {say(
          "Hypothetical payoff at expiration, not today’s option value. Only legs with the same underlying, expiration and currency are combined. Premiums initially use broker cost, which may be adjusted: enter actual premiums paid/received. Assumes contracts remain open to expiry; excludes early assignment and taxes.",
          "模拟到期盈亏，并非期权当前价值。仅合并相同标的、到期日和币种的期权。权利金默认使用券商成本（可能已调整），请输入实际支付或收取的权利金。假设持有至到期，不考虑提前行权和税费。",
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
        {say("Underlying price at expiration", "到期标的价格")}:{" "}
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
      <output
        className={`block text-2xl font-semibold ${valid && expirationPayoff(legs, scenario, Number(fees)) < 0 ? "text-negative" : "text-positive"}`}
      >
        {valid
          ? money(expirationPayoff(legs, scenario, Number(fees)))
          : say("Enter valid premiums and fees", "请输入有效的权利金和费用")}
      </output>
      {valid && (
        <ChartFrame title={say("Expiration profit / loss", "到期损益")}>
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
                name={say("Profit / loss", "损益")}
                type="linear"
                stroke={seriesColor(0)}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      )}
    </section>
  );
}
