"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "@/types/portfolio";
import {
  ChartFrame,
  Legend,
  OTHER,
  SURFACE,
  Tip,
  exactUsd,
  seriesColor,
} from "./chart-kit";

/**
 * Nine named holdings plus the folded tail. Nine is the number of validated
 * categorical hues; past it the tail becomes "Other" rather than inventing a
 * colour. A donut reads part-to-whole best at around six, so at this size the
 * legend and the labels carry identity and the arcs carry proportion.
 */
const MAX_SLICES = 10;

function fold(slices: AllocationSlice[]): AllocationSlice[] {
  if (slices.length <= MAX_SLICES) return slices;
  const head = slices.slice(0, MAX_SLICES - 1);
  const tail = slices.slice(MAX_SLICES - 1);
  return [
    ...head,
    {
      key: "__other",
      label: `Other (${tail.length})`,
      value: tail.reduce((acc, s) => acc + Number(s.value), 0).toFixed(2),
      percent: tail.reduce((acc, s) => acc + s.percent, 0),
    },
  ];
}

export function AllocationDonut({
  slices,
  title,
  note,
}: {
  slices: AllocationSlice[];
  title: string;
  note?: string;
}) {
  const data = fold(slices);
  const items = data.map((slice, index) => ({
    label: slice.label,
    value: slice.value,
    percent: slice.percent,
    // The folded tail is neutral wherever it lands, so it never reads as a
    // holding of its own.
    color: slice.key === "__other" ? OTHER : seriesColor(index),
  }));

  return (
    <ChartFrame title={title} note={note} height={300}>
      <div className="grid h-full grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="h-[180px] sm:h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey={(slice: AllocationSlice) => Number(slice.value)}
                nameKey="label"
                innerRadius="58%"
                outerRadius="88%"
                stroke={SURFACE}
                strokeWidth={2}
                isAnimationActive={false}
              >
                {data.map((slice, index) => (
                  <Cell key={slice.key} fill={seriesColor(index)} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const slice = payload[0].payload as AllocationSlice;
                  return (
                    <Tip
                      label={slice.label}
                      rows={[
                        { name: "Market value", value: exactUsd(Number(slice.value)) },
                        { name: "Weight", value: `${slice.percent.toFixed(2)}%` },
                      ]}
                    />
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <Legend items={items} />
      </div>
    </ChartFrame>
  );
}
