import type { DB } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { loadPortfolio } from "@/lib/portfolio/service";
import { visibleTo } from "@/lib/portfolios";
import { allLeaderboards, PERIODS, type Period } from "./index";
import { trophiesFor } from "./trophies";

/**
 * What the commentator is allowed to know.
 *
 * Percentages and weights, never money. The same rule as the leaderboard and
 * for the same reason: everyone in the family can read what comes out of
 * here, and how much each of them has is not part of the competition.
 *
 * Holdings themselves are included — Carson asked for them — because which
 * shares you picked is the thing worth arguing about, and it says nothing
 * about the size of your account.
 */
function percent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return (numerator / denominator) * 100;
}

const fmt = (value: number | null) =>
  value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

async function holdingsLines(db: DB, portfolioId: string): Promise<string[]> {
  const { positions, summary } = await loadPortfolio(portfolioId);
  const total = Number(summary.totalMarketValue.amount);
  if (!Number.isFinite(total) || total === 0) return ["  (nothing held)"];

  return positions
    .filter((position) => position.instrumentType !== "cash")
    .map((position) => {
      const value = Number(position.marketValue.amount);
      const cost = Number(position.costBasis.amount);
      const gain = Number(position.unrealizedPnL.amount);
      return {
        symbol: position.symbol,
        weight: percent(value, total) ?? 0,
        gain: percent(gain, Math.abs(cost)),
        today: position.todayPnLPercent ?? null,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12)
    .map(
      (holding) =>
        `  ${holding.symbol.padEnd(20)} ${holding.weight.toFixed(1).padStart(5)}% of portfolio` +
        `   since bought ${fmt(holding.gain)}   today ${fmt(holding.today)}`,
    );
}

/**
 * The grounded context for Arena commentary.
 *
 * Roughly a page per competitor. Everything the model is allowed to assert
 * about the family is in here; anything not in here it must say it does not
 * know.
 */
export async function buildArenaContext(
  db: DB,
  user: AuthUser,
  period: Period,
  now: Date = new Date(),
): Promise<{ text: string; symbols: string[] }> {
  const portfolios = await visibleTo(db, user);
  const boards = await allLeaderboards(db, user, now);
  const trophies = await trophiesFor(db, portfolios.map((p) => p.id), 30);

  const lines: string[] = [];
  const symbols = new Set<string>();

  lines.push(`# THE ARENA — ${period.toUpperCase()}`);
  lines.push(
    "All figures are percentages. Account values, cash balances and profits in",
    "currency are deliberately not provided and must never be guessed at.",
    "",
  );

  lines.push("## STANDINGS");
  for (const name of PERIODS) {
    const row = boards[name].standings
      .map((standing) => `${standing.displayName} ${fmt(standing.returnPercent)}`)
      .join("   ");
    lines.push(`  ${name.padEnd(6)} ${row}`);
  }
  lines.push("");

  for (const portfolio of portfolios) {
    const standing = boards[period].standings.find((s) => s.slug === portfolio.slug);
    lines.push(`## ${portfolio.displayName}${portfolio.kind === "mock" ? " (mock account)" : ""}`);
    lines.push(`  ${period} return: ${fmt(standing?.returnPercent ?? null)}`);
    if (standing?.unavailable) lines.push(`  note: ${standing.unavailable}`);

    const held = await holdingsLines(db, portfolio.id);
    lines.push("  holdings, largest first:");
    lines.push(...held);
    for (const line of held) {
      const symbol = line.trim().split(/\s+/)[0];
      if (symbol && symbol !== "(nothing") symbols.add(symbol);
    }
    lines.push("");
  }

  if (trophies.length > 0) {
    lines.push("## ALREADY WON");
    for (const trophy of trophies.filter((t) => t.rank === 1).slice(0, 10)) {
      lines.push(
        `  ${trophy.portfolioName} took the ${trophy.period} ending ${trophy.periodEnd} with ${fmt(trophy.returnPercent)}`,
      );
    }
    lines.push("");
  }

  return { text: lines.join("\n"), symbols: [...symbols] };
}

export const ARENA_RULES = [
  "The standings above are the complete and authoritative record.",
  "Every figure you state about a family member must appear in it verbatim.",
  "You have no account values, cash balances or profits in currency, and must never invent or estimate one.",
  "If someone asks how much money anyone has, say that the Arena does not carry it.",
  "News items are other people's reporting: attribute them, and never restate one as a fact about the family's portfolios.",
].join(" ");
