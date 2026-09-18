"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "@/types/portfolio";
import {
  ChartFrame,
  Legend,
  SURFACE,
  Tip,
  exactUsd,
  seriesColor,
  shortSymbol,
} from "./chart-kit";

/** Past six slices a donut stops reading as part-to-whole, so the tail folds in. */
const MAX_SLICES = 6;

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

export function AllocationDonut({ slices }: { slices: AllocationSlice[] }) {
  const data = fold(slices);
  const items = data.map((slice, index) => ({
    label: shortSymbol(slice.label),
    value: slice.value,
    percent: slice.percent,
    color: seriesColor(index),
  }));

  return (
    <ChartFrame title="Portfolio allocation" height={280}>
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
