"use client";

import { marketSessionLabel } from "@/lib/market-hours";
import type { PortfolioSummary } from "@/types/portfolio";

function clockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const DOT_COLOR: Record<PortfolioSummary["marketStatus"], string> = {
  regular: "var(--positive)",
  "pre-market": "var(--chart-4)",
  "after-hours": "var(--chart-4)",
  closed: "var(--muted-foreground)",
};

export function MarketStatus({
  summary,
  refreshing,
}: {
  summary: PortfolioSummary;
  refreshing?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ background: DOT_COLOR[summary.marketStatus] }}
        />
        {marketSessionLabel(summary.marketStatus)}
      </span>

      <span aria-hidden="true">·</span>

      <span>
        Last updated: <span className="tabular">{clockTime(summary.dataTimestamp)}</span>
        {refreshing && <span className="ml-1.5 opacity-60">refreshing…</span>}
      </span>

      {summary.isStale && (
        <span className="w-full text-negative sm:w-auto">
          Live data temporarily unavailable — showing last known prices.
        </span>
      )}
    </div>
  );
}
