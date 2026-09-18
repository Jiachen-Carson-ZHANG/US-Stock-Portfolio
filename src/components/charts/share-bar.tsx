"use client";

import type { AllocationSlice } from "@/types/portfolio";
import { compactUsd, seriesColor } from "./chart-kit";

/**
 * Part-to-whole for a handful of categories. A three-slice pie reads poorly, so
 * asset type and sector use one segmented bar plus a labelled list instead.
 */
export function ShareBar({
  title,
  slices,
}: {
  title: string;
  slices: AllocationSlice[];
}) {
  if (slices.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>

      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {slices.map((slice, index) => (
          <div
            key={slice.key}
            title={`${slice.label} ${slice.percent.toFixed(1)}%`}
            style={{
              width: `${Math.max(slice.percent, 0.5)}%`,
              background: seriesColor(index),
            }}
          />
        ))}
      </div>

      <ul className="mt-4 space-y-2">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: seriesColor(index) }}
            />
            <span className="truncate text-foreground">{slice.label}</span>
            <span className="tabular ml-auto shrink-0 text-muted-foreground">
              {slice.percent.toFixed(1)}%
            </span>
            <span className="tabular w-20 shrink-0 text-right text-foreground">
              {compactUsd(Number(slice.value))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
