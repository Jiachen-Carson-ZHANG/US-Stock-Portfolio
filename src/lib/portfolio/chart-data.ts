import type { OptionGroupDTO } from "./options";
import type { PositionView } from "@/types/portfolio";

export type PnLDatum = { symbol: string; value: number };

/**
 * One bar per holding, with option spreads netted exactly as the holdings
 * table nets them.
 *
 * Charting the legs separately made a spread appear as an enormous gain and an
 * enormous loss that cancel out — NBIS showed +1,246.80 and −995.00 rather
 * than the +251.80 it is, taking both ends of the chart at once. It also
 * disagreed with the table on the same screen, where GOOGL reads −148.80 and
 * here appeared as one of the largest gains.
 */
export function pnlByHolding(
  positions: PositionView[],
  groups: OptionGroupDTO[],
  pickPosition: (p: PositionView) => number,
  pickGroup: (g: OptionGroupDTO) => number,
): PnLDatum[] {
  const legIds = new Set(
    groups.flatMap((g) => (g.legs as PositionView[]).map((leg) => leg.id)),
  );

  return [
    ...positions
      .filter((p) => p.instrumentType !== "cash" && !legIds.has(p.id))
      .map((p) => ({ symbol: p.symbol, value: pickPosition(p) })),
    ...groups.map((g) => ({
      symbol: `${g.underlying} ${g.expirationDate ?? ""}`.trim(),
      value: pickGroup(g),
    })),
  ]
    .filter((d) => d.value !== 0)
    .sort((a, b) => b.value - a.value);
}
