"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS,
  AXIS_TICK,
  ChartFrame,
  GRID,
  NEGATIVE,
  POSITIVE,
  Tip,
  compactUsd,
  exactUsd,
} from "@/components/charts/chart-kit";
import { VerticalRoundedBar } from "@/components/charts/rounded-bar";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import type { AssetClassPerformance } from "@/lib/portfolio/options";

export function AssetClassSplit({ data }: { data: AssetClassPerformance[] }) {
  const t = useT();

  const label = (key: AssetClassPerformance["key"]) =>
    key === "stocks" ? t.performance.stocks : t.performance.options;

  const chartData = data.map((row) => ({
    name: label(row.key),
    value: Number(row.unrealizedPnL.amount),
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.map((row) => {
          const pnl = Number(row.unrealizedPnL.amount);
          return (
            <div
              key={row.key}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {label(row.key)}
              </p>
              <p className={`mt-2 text-xl font-semibold tracking-tight ${signClass(pnl)}`}>
                {formatMoney(row.unrealizedPnL, { signed: true })}
              </p>
              <p className={`text-sm ${signClass(pnl)}`}>
                {formatPercent(row.returnPercent, { signed: true })}
              </p>

              <dl className="mt-4 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t.summary.totalInvested}</dt>
                  <dd className="tabular">{formatMoney(row.invested)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t.table.marketValue}</dt>
                  <dd className="tabular">{formatMoney(row.marketValue)}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <ChartFrame title={t.charts.stocksVsOptions} height={260}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={compactUsd}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <ReferenceLine y={0} stroke={AXIS} />
            <Tooltip
              cursor={{ fill: GRID, fillOpacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const datum = payload[0].payload as { name: string; value: number };
                return (
                  <Tip
                    label={datum.name}
                    rows={[{ name: t.table.unrealized, value: exactUsd(datum.value) }]}
                  />
                );
              }}
            />
            <Bar
              dataKey="value"
              shape={<VerticalRoundedBar />}
              maxBarSize={72}
              isAnimationActive={false}
            >
              {chartData.map((datum) => (
                <Cell
                  key={datum.name}
                  fill={datum.value >= 0 ? POSITIVE : NEGATIVE}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
