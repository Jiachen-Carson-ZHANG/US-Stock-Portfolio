import type { PortfolioSnapshot } from "@/types/portfolio";
import {
  adjustedSeries,
  analysisStats,
  type CashFlow,
  type Coverage,
} from "@/lib/analysis/math";
export {
  dailyReturns,
  maxDrawdownPercent,
  annualisedVolatilityPercent,
} from "@/lib/analysis/statistics";
export type { SeriesStats } from "@/lib/analysis/statistics";
/** Returns require a reviewed external-flow ledger; raw account growth is not performance. */
export function statsFor(
  snapshots: PortfolioSnapshot[],
  flows: CashFlow[] = [],
  coverage: Coverage | null = null,
) {
  return analysisStats(adjustedSeries(snapshots, flows, coverage));
}
