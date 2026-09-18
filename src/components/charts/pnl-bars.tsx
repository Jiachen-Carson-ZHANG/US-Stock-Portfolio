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
  NEGATIVE,
  POSITIVE,
  Tip,
  compactUsd,
  exactUsd,
  shortSymbol,
} from "./chart-kit";
import { HorizontalRoundedBar, VerticalRoundedBar } from "./rounded-bar";
import { useT } from "@/lib/i18n/context";

type Datum = { symbol: string; value: number };

function toData(
  positions: PositionView[],
  pick: (p: PositionView) => number,
): Datum[] {
  return positions
    .filter((p) => p.instrumentType !== "cash")
    .map((p) => ({ symbol: p.symbol, value: pick(p) }))
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value);
}

export function UnrealizedPnLBars({ positions }: { positions: PositionView[] }) {
  const t = useT();
  const data = toData(positions, (p) => Number(p.unrealizedPnL.amount));
  if (data.length === 0) return null;

  return (
    <ChartFrame title={t.charts.unrealizedByPosition} height={Math.max(220, data.length * 44)}>
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
              const datum = payload[0].payload as Datum;
              return (
                <Tip
                  label={datum.symbol}
                  rows={[
                    { name: t.table.unrealized, value: exactUsd(datum.value) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="value"
            shape={<HorizontalRoundedBar />}
            maxBarSize={28}
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

export function ContributionBars({ positions }: { positions: PositionView[] }) {
  const t = useT();
  const data = toData(positions, (p) => Number(p.todayPnL.amount));
  if (data.length === 0) {
    return (
      <ChartFrame
        title={t.charts.contribution}
        note={t.charts.noHistory}
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
              const datum = payload[0].payload as Datum;
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
