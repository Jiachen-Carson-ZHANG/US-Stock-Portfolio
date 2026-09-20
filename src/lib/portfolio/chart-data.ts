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

/**
 * What one spread costs, the way an options desk quotes it: the net divided by
 * the contracts behind it. NBIS is 2 contracts, so its $3,180 net cost is
 * $15.90 a spread against $17.16 now — the comparison the price column exists
 * to make, and which a dash could not.
 */
export function spreadUnits(group: OptionGroupDTO): number {
  const legs = group.legs as PositionView[];
  const contracts = Math.max(...legs.map((l) => Math.abs(l.quantity)), 0);
  const multiplier = legs[0]?.contractMultiplier ?? 100;
  return contracts * multiplier;
}

/** Per-spread price now and paid. Null when the contract count is unknown. */
export function spreadPrices(
  group: OptionGroupDTO,
): { now: number; paid: number } | null {
  const units = spreadUnits(group);
  if (!units) return null;
  return {
    now: Number(group.netMarketValue.amount) / units,
    paid: Number(group.netCost.amount) / units,
  };
}

export type ReturnDatum = {
  symbol: string;
  unrealized: number;
  realized: number;
  total: number;
};

/**
 * Both halves of each holding's result in one row: what it is still carrying
 * and what it has already banked.
 *
 * The broker reports realized only against positions still open, so the two
 * columns alone do not reach the portfolio's total return. `closedRealized`
 * carries the remainder — everything banked on holdings since sold, which is
 * $949 here and would otherwise simply vanish from the chart. With it the bars
 * sum to the total return on the summary card.
 */
export function returnByHolding(
  positions: PositionView[],
  groups: OptionGroupDTO[],
  closedRealized: number,
  closedLabel: string,
): ReturnDatum[] {
  const legIds = new Set(
    groups.flatMap((g) => (g.legs as PositionView[]).map((leg) => leg.id)),
  );
  const realizedOf = (p: PositionView) => p.reportedRealizedPnL ?? 0;

  const rows: ReturnDatum[] = [
    ...positions
      .filter((p) => p.instrumentType !== "cash" && !legIds.has(p.id))
      .map((p) => ({
        symbol: p.symbol,
        unrealized: Number(p.unrealizedPnL.amount),
        realized: realizedOf(p),
      })),
    ...groups.map((g) => ({
      symbol: `${g.underlying} ${g.expirationDate ?? ""}`.trim(),
      unrealized: Number(g.unrealizedPnL.amount),
      realized: (g.legs as PositionView[]).reduce((n, l) => n + realizedOf(l), 0),
    })),
  ].map((r) => ({ ...r, total: r.unrealized + r.realized }));

  if (Math.abs(closedRealized) >= 0.005) {
    rows.push({
      symbol: closedLabel,
      unrealized: 0,
      realized: closedRealized,
      total: closedRealized,
    });
  }

  return rows
    .filter((r) => r.unrealized !== 0 || r.realized !== 0)
    .sort((a, b) => b.total - a.total);
}
