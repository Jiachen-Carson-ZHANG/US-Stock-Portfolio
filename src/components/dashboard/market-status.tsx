"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import type { PortfolioSummary } from "@/types/portfolio";

/**
 * The viewer's own clock, with the zone named.
 *
 * Everyone reading this is on UTC+8 today, but a bare "05:25:10 PM" beside a
 * US market status invites reading it as New York time. Naming the zone costs
 * a few characters and removes the question.
 */
function clockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
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
  onRefresh,
}: {
  summary: PortfolioSummary;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const t = useT();

  const sessionLabel = {
    "pre-market": t.market.preMarket,
    regular: t.market.regular,
    "after-hours": t.market.afterHours,
    closed: t.market.closed,
  }[summary.marketStatus];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ background: DOT_COLOR[summary.marketStatus] }}
        />
        {sessionLabel}
      </span>

      <span aria-hidden="true">·</span>

      <span>
        {t.market.lastUpdated}:{" "}
        <span className="tabular">{clockTime(summary.dataTimestamp)}</span>
      </span>

      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw
            aria-hidden="true"
            className={cn("size-3.5", refreshing && "animate-spin")}
          />
          {refreshing ? t.market.refreshing : t.market.refresh}
        </button>
      )}

      {summary.isStale && (
        <span className="w-full text-negative sm:w-auto">{t.market.stale}</span>
      )}
    </div>
  );
}
