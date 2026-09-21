"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK, ChartFrame, GRID, SURFACE, Tip, seriesColor } from "./chart-kit";

export type IndexPoint = { date: string; index: number };

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}

const format = (value: number) => value.toFixed(2);

/**
 * A portfolio's performance as an index starting at 100.
 *
 * Deliberately separate from ValueLine, which formats its axis as money.
 * This chart has no currency option at all, so the Arena cannot be made to
 * disclose an account's size by passing the wrong prop. The 100 line is
 * drawn because "did it go up" is the only question being asked.
 */
export function IndexLine({
  title,
  note,
  data,
  height = 220,
  colorIndex = 0,
}: {
  title: string;
  note?: string;
  data: IndexPoint[];
  height?: number;
  colorIndex?: number;
}) {
  if (data.length < 2) {
    return (
      <ChartFrame title={title} note="Not enough history yet." height={140}>
        <div />
      </ChartFrame>
    );
  }

  const values = data.map((point) => point.index);
  const min = Math.min(...values, 100);
  const max = Math.max(...values, 100);
  const pad = (max - min) * 0.1 || 1;

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
            tickFormatter={format}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <ReferenceLine y={100} stroke={GRID} strokeDasharray="3 3" />
          <Tooltip
            cursor={{ stroke: seriesColor(colorIndex), strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as IndexPoint;
              return (
                <Tip
                  label={point.date}
                  rows={[
                    {
                      name: "Index",
                      value: format(point.index),
                      color: seriesColor(colorIndex),
                    },
                    {
                      name: "Change",
                      value: `${point.index >= 100 ? "+" : ""}${(point.index - 100).toFixed(2)}%`,
                    },
                  ]}
                />
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="index"
            stroke={seriesColor(colorIndex)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
