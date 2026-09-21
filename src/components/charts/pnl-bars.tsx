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
import type { PositionView } from "@/types/portfolio";
import {
  AXIS,
  AXIS_TICK,
  ChartFrame,
  GRID,
  SeriesLegend,
  NEGATIVE,
  POSITIVE,
  Tip,
  seriesColor,
  compactUsd,
  exactUsd,
  shortSymbol,
} from "./chart-kit";
import { VerticalRoundedBar } from "./rounded-bar";
import { useT } from "@/lib/i18n/context";
import type { OptionGroupDTO } from "@/lib/portfolio/options";
import {
  pnlByHolding,
  returnByHolding,
  type PnLDatum,
  type ReturnDatum,
} from "@/lib/portfolio/chart-data";

export function UnrealizedPnLBars({
  positions,
  optionGroups,
  realizedBySymbol = {},
  unattributed = 0,
}: {
  positions: PositionView[];
  optionGroups: OptionGroupDTO[];
  /** Realized per symbol, replayed from the fills. */
  realizedBySymbol?: Record<string, number>;
  /** What the fills cannot explain — dividends, interest, the gift share. */
  unattributed?: number;
}) {
  const t = useT();
  const data = returnByHolding(positions, optionGroups, realizedBySymbol, unattributed, {
    closed: t.charts.closedPositions,
    other: t.charts.unattributed,
  });
  if (data.length === 0) return null;

  // Two series, so a legend is required: colour alone must not carry which
  // half of the result a segment is.
  const series = [
    { key: "unrealized" as const, label: t.summary.unrealized, color: seriesColor(0) },
    { key: "realized" as const, label: t.summary.realized, color: seriesColor(2) },
  ];

  return (
    <ChartFrame
      title={t.charts.returnByPosition}
      note={t.charts.returnByPositionNote}
      height={Math.max(240, data.length * 44 + 40)}
    >
      <div className="flex h-full flex-col gap-2">
        <SeriesLegend items={series.map((s) => ({ label: s.label, color: s.color }))} />
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis
                type="number"
                tickFormatter={compactUsd}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="symbol"
                tickFormatter={shortSymbol}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={88}
              />
              <ReferenceLine x={0} stroke={AXIS} />
              <Tooltip
                cursor={{ fill: GRID, fillOpacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as ReturnDatum;
                  return (
                    <Tip
                      label={d.symbol}
                      rows={[
                        { name: series[0].label, value: exactUsd(d.unrealized), color: series[0].color },
                        { name: series[1].label, value: exactUsd(d.realized), color: series[1].color },
                        { name: t.summary.totalReturn, value: exactUsd(d.total) },
                      ]}
                    />
                  );
                }}
              />
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="result"
                  fill={s.color}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartFrame>
  );
}

export function ContributionBars({
  positions,
  optionGroups,
}: {
  positions: PositionView[];
  optionGroups: OptionGroupDTO[];
}) {
  const t = useT();
  const data = pnlByHolding(
    positions,
    optionGroups,
    (p) => Number(p.todayPnL.amount),
    (g) => Number(g.todayPnL.amount),
  );
  if (data.length === 0) {
    return (
      <ChartFrame
        title={t.charts.contribution}
        note={t.charts.noMovementToday}
        height={120}
      >
        <div />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={t.charts.contribution}
      note={t.charts.contributionNote}
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="symbol"
            tickFormatter={shortSymbol}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
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
              const datum = payload[0].payload as PnLDatum;
              return (
                <Tip
                  label={datum.symbol}
                  rows={[{ name: t.table.today, value: exactUsd(datum.value) }]}
                />
              );
            }}
          />
          <Bar
            dataKey="value"
            shape={<VerticalRoundedBar />}
            maxBarSize={56}
            isAnimationActive={false}
          >
            {data.map((datum) => (
              <Cell
                key={datum.symbol}
                fill={datum.value >= 0 ? POSITIVE : NEGATIVE}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
