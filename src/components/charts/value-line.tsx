"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_TICK,
  ChartFrame,
  GRID,
  SURFACE,
  Tip,
  exactUsd,
  makeCurrencyTick,
  seriesColor,
} from "./chart-kit";

export type LinePoint = { date: string; value: number };

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** Single series, so the title names it and no legend box is needed. */
export function ValueLine({
  title,
  note,
  data,
  height = 280,
  valueLabel = "Value",
  currency = "USD",
}: {
  title: string;
  note?: string;
  data: LinePoint[];
  height?: number;
  valueLabel?: string;
  currency?: string;
}) {
  if (data.length === 0) {
    return (
      <ChartFrame title={title} note="No history recorded yet." height={140}>
        <div />
      </ChartFrame>
    );
  }

  const formatValue = (value: number) => currency === "USD" ? exactUsd(value) : new Intl.NumberFormat("en-US", {style:"currency",currency}).format(value);
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;

  return (
    <ChartFrame title={title} note={note} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tickFormatter={currency === "USD" ? makeCurrencyTick(min, max) : value => new Intl.NumberFormat("en-US", {style:"currency",currency,notation:"compact"}).format(value)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={72}
          />
          <Tooltip
            cursor={{ stroke: seriesColor(0), strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as LinePoint;
              return (
                <Tip
                  label={point.date}
                  rows={[
                    {
                      name: valueLabel,
                      value: formatValue(point.value),
                      color: seriesColor(0),
                    },
                  ]}
                />
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={seriesColor(0)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
