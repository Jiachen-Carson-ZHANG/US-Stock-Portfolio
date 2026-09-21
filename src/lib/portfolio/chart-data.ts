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
 * Realized comes from replaying the fills rather than from the broker, which
 * attributes it only to open positions. That is what lets a name sold out of
 * — META, MRVL, LITE — appear under its own name instead of disappearing into
 * an anonymous "closed positions" bar.
 *
 * `unattributed` carries whatever the fills cannot explain: the gift share and
 * a few dollars of dividends and interest. It is shown rather than dropped, so
 * the bars still sum to the total return on the summary card.
 */
export function returnByHolding(
  positions: PositionView[],
  groups: OptionGroupDTO[],
  realizedBySymbol: Record<string, number>,
  unattributed: number,
  labels: { closed: string; other: string },
): ReturnDatum[] {
  const legIds = new Set(
    groups.flatMap((g) => (g.legs as PositionView[]).map((leg) => leg.id)),
  );
  const accounted = new Set<string>();

  const take = (symbol: string) => {
    accounted.add(symbol);
    return realizedBySymbol[symbol] ?? 0;
  };

  const rows: Omit<ReturnDatum, "total">[] = [
    ...positions
      .filter((p) => p.instrumentType !== "cash" && !legIds.has(p.id))
      .map((p) => ({
        symbol: p.symbol,
        unrealized: Number(p.unrealizedPnL.amount),
        realized: take(p.symbol),
      })),
    ...groups.map((g) => ({
      symbol: `${g.underlying} ${g.expirationDate ?? ""}`.trim(),
      unrealized: Number(g.unrealizedPnL.amount),
      realized: (g.legs as PositionView[]).reduce((n, l) => n + take(l.symbol), 0),
    })),
  ];

  // Anything with a realized result and no position left is a name sold out
  // of. It gets its own row, marked, rather than being bundled away.
  for (const [symbol, amount] of Object.entries(realizedBySymbol)) {
    if (accounted.has(symbol) || amount === 0) continue;
    rows.push({ symbol: `${symbol} · ${labels.closed}`, unrealized: 0, realized: amount });
  }

  if (Math.abs(unattributed) >= 0.005) {
    rows.push({ symbol: labels.other, unrealized: 0, realized: unattributed });
  }

  return rows
    .map((r) => ({ ...r, total: r.unrealized + r.realized }))
    .filter((r) => r.unrealized !== 0 || r.realized !== 0)
    .sort((a, b) => b.total - a.total);
}
