// No `server-only` guard, matching src/lib/deepseek.ts: it would block the
// scripts that check what the model is actually being told, and this module is
// server-bound regardless because it opens the database.
import { daysToExpiration } from "@/lib/portfolio";
import { loadPortfolio, loadTransactions } from "@/lib/portfolio/service";
import { readWatchlist } from "@/lib/watchlist";
import { getDb } from "@/lib/db";
import type { OptionGroupDTO } from "@/lib/portfolio/options";
import type { MoneyDTO, PositionView } from "@/types/portfolio";

/**
 * The whole portfolio, rendered for a language model.
 *
 * The holdings are small enough (~700 tokens) that retrieval would cost more
 * than it saves, so everything goes in. The important part is *what* goes in:
 * every derived figure (weights, returns, and for each spread its best case,
 * worst case and break-even) is computed here by the same code the dashboard
 * renders, in decimal arithmetic.
 *
 * That is deliberate. A model asked to work out the max profit on a vertical
 * will produce a plausible number rather than the right one, and nobody reading
 * the note can tell the difference. Handing it the answer means the note and
 * the table can never disagree.
 *
 * Nothing identifying goes in: no usernames, account ids or session data. This
 * text leaves the server for a third-party model.
 */

const MAX_TRANSACTIONS = 40;

function pct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "n/a"
    : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** A share of something, never signed. */
function share(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "n/a" : `${value.toFixed(1)}%`;
}

function amount(value: MoneyDTO | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(typeof value === "object" ? value.amount : value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `part` as a percentage of `whole`, or null when that means nothing. */
function ratio(part: number | null, whole: number | null): number | null {
  return part === null || whole === null || whole === 0 ? null : (part / Math.abs(whole)) * 100;
}

/** A leg by its terms alone. How many contracts is left out: with the price it gives the size. */
function contractLabel(leg: PositionView): string {
  const side = leg.quantity < 0 ? "short" : "long";
  return `${side} ${leg.optionType ?? "?"} ${leg.strike ?? "?"}`;
}

/**
 * The portfolio in percentages, for a language model.
 *
 * Only shares and returns go in, never money. The account's size, its cash,
 * each holding's value and every profit in dollars stay on this server: how
 * much somebody has is theirs, and a percentage says everything the
 * commentary needs about how it is doing. Prices per share are public market
 * data and stay in, but never beside a quantity, which together would give the
 * size away.
 */
export async function buildAiContext(
  portfolioId: string,
  now: Date = new Date(),
): Promise<string> {
  const [portfolio, history] = await Promise.all([
    loadPortfolio(portfolioId, now),
    loadTransactions(portfolioId, now).catch(() => null),
  ]);
  const { summary, positions, concentration, optionGroups, byAssetClass } = portfolio;
  const total = amount(summary.totalMarketValue);

  const lines: string[] = [];
  const add = (line: string) => lines.push(line);

  add("# PORTFOLIO SNAPSHOT (percentages only)");
  add(
    `As of ${summary.dataTimestamp ?? "unknown"}; market ${summary.marketStatus}` +
      `${summary.isStale ? "; PRICES ARE STALE, say so if you cite one" : ""}`,
  );
  add(
    "The account's size, its cash balance and every profit in money are deliberately left out. Never guess at them.",
  );
  add("");

  add("## Totals");
  add(`Total return         ${pct(summary.totalReturnPercent)}`);
  add(`Unrealized           ${pct(summary.totalUnrealizedPnLPercent)} on what is held`);
  add(`Realized             ${pct(summary.realizedPnLPercent)}`);
  add(`Today                ${pct(summary.todayPnLPercent)}`);
  add(`Cash                 ${share(summary.cashPercent)} of the account`);
  add(
    `Concentration        top1 ${share(concentration.top1Percent)}, top3 ${share(concentration.top3Percent)}, top5 ${share(concentration.top5Percent)}`,
  );
  add("");

  if (byAssetClass.length > 0) {
    add("## By asset class");
    add("class | share of the account | return on what is held");
    for (const row of byAssetClass) {
      add(`${row.key} | ${share(ratio(amount(row.marketValue), total))} | ${pct(row.returnPercent)}`);
    }
    add("");
  }

  const stocks = positions.filter((p) => p.instrumentType !== "option" && p.instrumentType !== "cash");
  if (stocks.length > 0) {
    add("## Stock and ETF holdings");
    add("symbol | weight | return since bought | today | price per share");
    for (const p of stocks) {
      add(
        [
          p.symbol,
          share(p.investedWeightPercent ?? p.weightPercent),
          pct(p.unrealizedPnLPercent),
          pct(p.todayPnLPercent),
          amount(p.currentPrice)?.toFixed(2) ?? "n/a",
        ].join(" | "),
      );
    }
    add("");
  }

  if (optionGroups.length > 0) {
    add("## Option positions, grouped by strategy");
    add(
      "Best case, worst case and break-even come from the contract terms; use these rather than deriving your own.",
    );
    for (const group of optionGroups as OptionGroupDTO[]) {
      const dte = group.expirationDate ? daysToExpiration(group.expirationDate, now) : null;
      const cost = amount(group.netCost);
      add(
        `- ${group.underlying} ${group.strategy}` +
          (group.expirationDate ? ` exp ${group.expirationDate} (${dte} days)` : ""),
      );
      add(`    legs: ${(group.legs as PositionView[]).map(contractLabel).join(", ")}`);
      add(
        `    weight ${share(group.weightPercent)} | return ${pct(ratio(amount(group.unrealizedPnL), cost))} on what it cost`,
      );
      add(
        `    best case ${pct(ratio(amount(group.maxProfit), cost))} of cost | worst case ${
          group.maxLoss === null ? "unlimited" : pct(ratio(-Math.abs(amount(group.maxLoss) ?? 0), cost))
        } of cost | break-even ${group.breakEven === null ? "n/a" : group.breakEven.toFixed(2)}`,
      );
    }
    add("");
  }

  if (history && history.transactions.length > 0) {
    const recent = history.transactions.slice(0, MAX_TRANSACTIONS);
    add(`## Recent trades (${recent.length} most recent)`);
    add("The broker serves roughly 90 days, so anything older is absent. Do not read this as the full history.");
    add("date | side | symbol | price per share");
    for (const t of recent) {
      add([t.tradedAt.slice(0, 10), t.side, t.symbol, amount(t.price)?.toFixed(2) ?? "n/a"].join(" | "));
    }
    add("");
  }

  try {
    const watchlist = await readWatchlist(await getDb());
    if (watchlist.length > 0) {
      add("## Watchlist (not owned)");
      for (const entry of watchlist) {
        add(`- ${entry.symbol}${entry.name ? ` (${entry.name})` : ""}: ${entry.reason}`);
      }
      add("");
    }
  } catch {
    // The watchlist is supporting detail; its absence must not fail the note.
  }

  return lines.join("\n").trim();
}

/**
 * Stated as a rule the model can be held to. Because every figure it could
 * legitimately need is above, "not in the context" and "invented" become the
 * same thing — which makes a wrong number checkable instead of merely plausible.
 */
export const GROUNDING_RULES = [
  "The PORTFOLIO SNAPSHOT above is the complete and authoritative record of this family's holdings.",
  "Every number you state about their portfolio must appear in it verbatim.",
  "Do not calculate derived figures yourself — the ones you need are already given.",
  "If a figure you want is not there, say plainly that you do not have it.",
  "You may discuss the wider market from your own knowledge, but never state a price, date or result as fact unless it is above.",
].join(" ");
