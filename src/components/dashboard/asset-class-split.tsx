"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
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
  SeriesLegend,
  Tip,
  compactUsd,
  exactUsd,
  seriesColor,
} from "@/components/charts/chart-kit";
import { VerticalRoundedBar } from "@/components/charts/rounded-bar";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import { Help } from "@/components/ui/help";
import type { AssetClassPerformance } from "@/lib/portfolio/options";

/**
 * How each class has actually done.
 *
 * Judging a class on open positions alone judges it on whichever trades
 * happened to survive: sell your winners and the class looks worse than it
 * was. Both halves are shown, side by side, each measured from zero, with
 * the total on the cards above.
 *
 * Side by side, not stacked. Stacked, a small unrealized loss was a sliver
 * on top of a large realized one and read as the realized bar covering it;
 * two bars from the same baseline need no arithmetic to read.
 */
export function AssetClassSplit({ data }: { data: AssetClassPerformance[] }) {
  const t = useT();

  const label = (key: AssetClassPerformance["key"]) =>
    key === "stocks" ? t.performance.stocks : t.performance.options;

  const chartData = data.map((row) => ({
    name: label(row.key),
    unrealized: Number(row.unrealizedPnL.amount),
    realized: Number(row.realizedPnL.amount),
    total: Number(row.totalPnL.amount),
  }));

  const series = [
    { key: "unrealized" as const, label: t.summary.unrealized, color: seriesColor(0) },
    // Orange, not the third colour: that green read as profit even on a loss.
    { key: "realized" as const, label: t.summary.realized, color: seriesColor(1) },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.map((row) => {
          const pnl = Number(row.totalPnL.amount);
          return (
            <div
              key={row.key}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {label(row.key)}
                {/* These two cards and the chart below them answer different
                    questions, and reading one as the other is how a green
                    card sits above a red index. This says which is which. */}
                <Help title={t.performance.sinceStart}>
                  {t.performance.sinceStartBody}
                </Help>
              </p>
              <p className={cn("mt-2 text-xl font-semibold tracking-tight", signClass(pnl))}>
                {formatMoney(row.totalPnL, { signed: true })}
              </p>
              <p className={cn("text-sm", signClass(pnl))}>
                {formatPercent(row.totalReturnPercent, { signed: true })}{" "}
                <span className="text-muted-foreground">
                  {t.summary.totalReturn.toLowerCase()}
                </span>
              </p>

              <dl className="mt-4 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t.summary.unrealized}</dt>
                  <dd
                    className={cn(
                      "tabular",
                      signClass(Number(row.unrealizedPnL.amount)),
                    )}
                  >
                    {formatMoney(row.unrealizedPnL, { signed: true })}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t.summary.realized}</dt>
                  <dd
                    className={cn(
                      "tabular",
                      signClass(Number(row.realizedPnL.amount)),
                    )}
                  >
                    {formatMoney(row.realizedPnL, { signed: true })}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-border pt-1.5">
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

      <ChartFrame title={t.charts.stocksVsOptions} height={280}>
        <div className="flex h-full flex-col gap-2">
          <SeriesLegend items={series.map((s) => ({ label: s.label, color: s.color }))} />
          <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            barGap={6}
            margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
          >
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
                const datum = payload[0].payload as (typeof chartData)[number];
                return (
                  <Tip
                    label={datum.name}
                    rows={[
                      {
                        name: series[0].label,
                        value: exactUsd(datum.unrealized),
                        color: series[0].color,
                      },
                      {
                        name: series[1].label,
                        value: exactUsd(datum.realized),
                        color: series[1].color,
                      },
                      { name: t.summary.totalReturn, value: exactUsd(datum.total) },
                    ]}
                  />
                );
              }}
            />
            {series.map((entry) => (
              <Bar
                key={entry.key}
                dataKey={entry.key}
                fill={entry.color}
                shape={<VerticalRoundedBar />}
                maxBarSize={48}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
          </div>
        </div>
      </ChartFrame>
    </div>
  );
}
