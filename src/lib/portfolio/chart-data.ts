import { parseSymbol } from "@/lib/moomoo/symbols";
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
 *
 * Every option on one stock is one row, open or closed and whatever its
 * expiry. Grouping only open spreads left a closed spread as its separate
 * contracts: the two APP call spreads opened on 30 Sep and closed on 5 Oct
 * read as −2,808 and −2,494 against +1,544 and +1,254, when what happened was
 * one loss of 2,504 on APP options. Which strikes and dates made it up is for
 * the holdings page. Shares keep their own row.
 */
export function returnByHolding(
  positions: PositionView[],
  realizedBySymbol: Record<string, number>,
  unattributed: number,
  labels: { closed: string; other: string; options: string },
): ReturnDatum[] {
  const rows = new Map<string, Omit<ReturnDatum, "total"> & { open: boolean }>();
  const rowFor = (symbol: string, underlying?: string) => {
    const parsed = parseSymbol(symbol);
    const stock = parsed.instrumentType === "option" ? (underlying ?? parsed.underlyingSymbol) : undefined;
    const key = stock ? `option:${stock}` : symbol;
    let row = rows.get(key);
    if (!row) {
      row = {
        symbol: stock ? labels.options.replace("{symbol}", stock) : symbol,
        unrealized: 0,
        realized: 0,
        open: false,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const p of positions) {
    if (p.instrumentType === "cash") continue;
    const row = rowFor(p.symbol, p.instrumentType === "option" ? p.underlyingSymbol : undefined);
    row.unrealized += Number(p.unrealizedPnL.amount);
    row.open = true;
  }

  // Anything with a realized result and no position left was sold out of. It
  // keeps its own row, marked, rather than being bundled away.
  for (const [symbol, amount] of Object.entries(realizedBySymbol)) {
    if (amount !== 0) rowFor(symbol).realized += amount;
  }

  const out: Omit<ReturnDatum, "total">[] = [...rows.values()].map(({ open, ...row }) => ({
    ...row,
    symbol: open ? row.symbol : `${row.symbol} · ${labels.closed}`,
  }));

  if (Math.abs(unattributed) >= 0.005) {
    out.push({ symbol: labels.other, unrealized: 0, realized: unattributed });
  }

  return out
    .map((r) => ({ ...r, total: r.unrealized + r.realized }))
    .filter((r) => r.unrealized !== 0 || r.realized !== 0)
    .sort((a, b) => b.total - a.total);
}
