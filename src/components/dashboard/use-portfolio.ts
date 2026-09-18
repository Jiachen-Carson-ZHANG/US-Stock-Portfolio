"use client";

import { useEffect, useRef, useState } from "react";
import { quotePollIntervalMs } from "@/lib/market-hours";
import type {
  AllocationSlice,
  MoneyDTO,
  PortfolioSummary,
  PositionView,
} from "@/types/portfolio";
import type { OptionGroupDTO } from "@/lib/portfolio/options";

export type LivePortfolio = {
  summary: PortfolioSummary;
  positions: PositionView[];
  allocations: {
    byPosition: AllocationSlice[];
    byAssetType: AllocationSlice[];
    bySector: AllocationSlice[];
  };
  totalInvested: MoneyDTO;
  optionGroups: OptionGroupDTO[];
};

/**
 * Polls the server-cached portfolio. Polling pauses while the tab is hidden and
 * fires immediately when it becomes visible again (§15). Previous data is held
 * across refetches so the UI never flashes a skeleton.
 */
export function usePortfolio(initial: LivePortfolio) {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const manualRefresh = useRef<() => void>(() => {});

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function refresh(force = false) {
      if (inFlight.current) return;
      if (!force && document.visibilityState === "hidden") return;
      inFlight.current = true;
      setRefreshing(true);

      try {
        const response = await fetch("/api/portfolio/positions", {
          cache: "no-store",
        });
        if (response.ok && !cancelled) {
          setData((await response.json()) as LivePortfolio);
        }
      } catch {
        // Leave the last good render in place; the summary carries staleness.
      } finally {
        inFlight.current = false;
        if (!cancelled) setRefreshing(false);
      }
    }

    manualRefresh.current = () => void refresh(true);

    function schedule() {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(async () => {
        await refresh();
        schedule();
      }, quotePollIntervalMs(data.summary.marketStatus));
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void refresh().then(schedule);
      } else {
        clearTimeout(timer);
      }
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [data.summary.marketStatus]);

  return { data, refreshing, refresh: () => manualRefresh.current() };
}
