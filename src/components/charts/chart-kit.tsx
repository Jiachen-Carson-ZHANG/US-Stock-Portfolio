"use client";

import * as React from "react";

export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

export const GRID = "var(--chart-grid)";
export const AXIS = "var(--chart-axis)";
export const POSITIVE = "var(--positive)";
export const NEGATIVE = "var(--negative)";
export const SURFACE = "var(--surface)";

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

const OCC_SYMBOL = /^([A-Z]+)\d{6}([CP])(\d{8})$/;

/**
 * Axis and legend labels only. An OCC option symbol is 19 characters and gets
 * clipped by any sane axis width, so render it as root + strike + side.
 */
export function shortSymbol(symbol: string): string {
  const occ = OCC_SYMBOL.exec(symbol);
  if (occ) return `${occ[1]} ${Number(occ[3]) / 1000}${occ[2]}`;
  if (symbol.endsWith(".CASH")) return "Cash";
  return symbol.length > 10 ? `${symbol.slice(0, 9)}…` : symbol;
}

export function compactUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/**
 * Picks tick precision from the span being plotted. A fixed compact format
 * collapses a narrow range — a $18.20–$19.40 price axis renders every tick as
 * "$19" and tells the reader nothing.
 */
export function makeCurrencyTick(min: number, max: number): (value: number) => string {
  const step = Math.abs(max - min) / 4;
  if (step >= 500) return compactUsd;
  if (step >= 1) return (value) => `$${Math.round(value).toLocaleString("en-US")}`;
  return (value) => `$${value.toFixed(2)}`;
}

export function exactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export const AXIS_TICK = {
  fill: AXIS,
  fontSize: 11,
} as const;

export function ChartFrame({
  title,
  note,
  height = 260,
  children,
}: {
  title: string;
  note?: string;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      {/* Height covers plot + axis band so the card never nests a scrollbar. */}
      <div style={{ height }}>{children}</div>
    </section>
  );
}

export function Tip({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: string; color?: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center gap-2 text-xs">
            {row.color && (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: row.color }}
              />
            )}
            <span className="text-muted-foreground">{row.name}</span>
            <span className="tabular ml-auto font-medium text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; value: string; percent: number; color: string }[];
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ background: item.color }}
          />
          <span className="truncate text-foreground">{item.label}</span>
          <span className="tabular ml-auto shrink-0 text-muted-foreground">
            {item.percent.toFixed(1)}%
          </span>
          <span className="tabular w-20 shrink-0 text-right text-foreground">
            {compactUsd(Number(item.value))}
          </span>
        </li>
      ))}
    </ul>
  );
}
