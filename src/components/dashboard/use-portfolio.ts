"use client";

import { useEffect, useRef, useState } from "react";
import { quotePollIntervalMs } from "@/lib/market-hours";
import type {
  AllocationSlice,
  Concentration,
  MoneyDTO,
  PortfolioSummary,
  PositionView,
} from "@/types/portfolio";
import type { OptionGroupDTO } from "@/lib/portfolio/options";

export type LivePortfolio = {
  concentration?: Concentration;
  summary: PortfolioSummary;
  positions: PositionView[];
  allocations: {
    byPosition: AllocationSlice[];
    byAssetType: AllocationSlice[];
    bySector: AllocationSlice[];
  };
  totalInvested: MoneyDTO;
  optionGroups: OptionGroupDTO[];
  /** Realized per symbol, replayed from the fills. */
  realizedBySymbol?: Record<string, number>;
};

/**
 * Polls the server-cached portfolio. Polling pauses while the tab is hidden and
 * fires immediately when it becomes visible again (§15). Previous data is held
 * across refetches so the UI never flashes a skeleton.
 */
/**
 * How long to wait for one refresh before giving up on it.
 *
 * Without this a request that never answers leaves the spinner turning for as
 * long as the tab is open, and the poll behind it never reschedules, because
 * it was waiting for the same request. "Refreshing…" forever is a worse lie
 * than "could not refresh".
 */
const REFRESH_TIMEOUT_MS = 12_000;

/** After a failure, wait longer each time, up to this. */
const MAX_BACKOFF_MS = 60_000;

/**
 * `portfolioSlug` is required, and that is the whole fix for a real bug.
 *
 * The refresh used to ask for "positions" without saying whose. The server
 * answers that question with the viewer's own default portfolio — which, for
 * anybody looking at an account shared with them, is their practice account.
 * So the page loaded the account they chose and, five seconds later, the
 * refresh quietly replaced it with their own. The owner never saw it, because
 * the owner's default is the account being looked at.
 */
export function usePortfolio(initial: LivePortfolio, portfolioSlug: string) {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [failures, setFailures] = useState(0);
  const inFlight = useRef(false);
  const manualRefresh = useRef<() => void>(() => {});

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let consecutiveFailures = 0;

    async function refresh(force = false) {
      if (inFlight.current) return;
      if (!force && document.visibilityState === "hidden") return;
      inFlight.current = true;
      setRefreshing(true);

      try {
        const response = await fetch(
          `/api/portfolio/positions?portfolio=${encodeURIComponent(portfolioSlug)}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
          },
        );
        if (response.ok && !cancelled) {
          setData((await response.json()) as LivePortfolio);
          consecutiveFailures = 0;
          setFailures(0);
        } else if (!cancelled) {
          consecutiveFailures += 1;
          setFailures(consecutiveFailures);
        }
      } catch {
        // Leave the last good render in place; the summary carries staleness.
        // Counting the failure is what makes the next poll back off instead
        // of hammering something that is already struggling.
        if (!cancelled) {
          consecutiveFailures += 1;
          setFailures(consecutiveFailures);
        }
      } finally {
        inFlight.current = false;
        if (!cancelled) setRefreshing(false);
      }
    }

    manualRefresh.current = () => void refresh(true);

    function schedule() {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      // Null means the market is closed and the number cannot change. The
      // manual refresh button still works, and re-showing the tab still
      // re-checks once in case the session has opened since.
      const interval = quotePollIntervalMs(data.summary.marketStatus);
      if (interval === null) return;

      // Back off after failures rather than asking every five seconds of a
      // feed that is rate-limiting us — which only makes the rate limit last
      // longer. Doubles each time to a minute, and resets on the first
      // success.
      const backoff = Math.min(
        interval * 2 ** Math.min(consecutiveFailures, 6),
        MAX_BACKOFF_MS,
      );

      timer = setTimeout(async () => {
        await refresh();
        schedule();
      }, consecutiveFailures > 0 ? backoff : interval);
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
  }, [data.summary.marketStatus, portfolioSlug]);

  return {
    data,
    refreshing,
    /** How many refreshes in a row have failed; zero once one succeeds. */
    failures,
    refresh: () => manualRefresh.current(),
  };
}
