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
 * every derived figure — cost basis, P&L, weights, and for each spread its max
 * profit, max loss and break-even — is computed here by the same code the
 * dashboard renders, in decimal arithmetic.
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

function n(value: MoneyDTO | string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const raw = typeof value === "object" ? value.amount : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "—";
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(2)}%`;
}

function contractLabel(leg: PositionView): string {
  const side = leg.quantity < 0 ? "short" : "long";
  const type = leg.optionType ?? "?";
  const strike = leg.strike ?? "?";
  return `${side} ${Math.abs(leg.quantity)}x ${type} ${strike}`;
}

export async function buildAiContext(now: Date = new Date()): Promise<string> {
  const [portfolio, history] = await Promise.all([
    loadPortfolio(now),
    loadTransactions(now).catch(() => null),
  ]);
  const { summary, positions, concentration, optionGroups, byAssetClass } =
    portfolio;
  const currency = summary.totalMarketValue.currency;

  const lines: string[] = [];
  const add = (line: string) => lines.push(line);

  add(`# PORTFOLIO SNAPSHOT (all amounts in ${currency})`);
  add(
    `As of ${summary.dataTimestamp ?? "unknown"}; market ${summary.marketStatus}` +
      `${summary.isStale ? "; PRICES ARE STALE — say so if you cite one" : ""}`,
  );
  add("");

  add("## Totals");
  add(`Account value        ${n(summary.totalMarketValue)}`);
  add(`Cash                 ${n(summary.cashValue)} (${pct(summary.cashPercent)})`);
  add(`Invested at cost     ${n(portfolio.totalInvested)}`);
  add(
    `Unrealized P&L       ${n(summary.totalUnrealizedPnL)} (${pct(summary.totalUnrealizedPnLPercent)})`,
  );
  add(`Realized P&L         ${n(summary.realizedPnL)} (broker-reported)`);
  if (summary.netDeposits) {
    add(`Net deposits         ${n(summary.netDeposits)} (cash paid in, less withdrawals)`);
  }
  add(
    `Total return         ${n(summary.totalReturn)} (${pct(summary.totalReturnPercent)})` +
      (summary.netDeposits
        ? " = account value less net deposits"
        : " = unrealized plus broker-reported realized"),
  );
  add(`Today                ${n(summary.todayPnL)} (${pct(summary.todayPnLPercent)})`);
  add(
    `Concentration        top1 ${pct(concentration.top1Percent)}, top3 ${pct(concentration.top3Percent)}, top5 ${pct(concentration.top5Percent)}`,
  );
  add("");

  if (byAssetClass.length > 0) {
    add("## By asset class");
    add("class | invested | value | unrealized | return");
    for (const row of byAssetClass) {
      add(
        `${row.key} | ${n(row.invested)} | ${n(row.marketValue)} | ${n(row.unrealizedPnL)} | ${pct(row.returnPercent)}`,
      );
    }
    add("");
  }

  const stocks = positions.filter(
    (p) => p.instrumentType !== "option" && p.instrumentType !== "cash",
  );
  if (stocks.length > 0) {
    add("## Stock and ETF holdings");
    add("symbol | qty | avg cost | price | value | cost basis | unrealized | % | weight");
    for (const p of stocks) {
      add(
        [
          p.symbol,
          p.quantity,
          n(p.averageCost),
          n(p.currentPrice),
          n(p.marketValue),
          n(p.costBasis),
          n(p.unrealizedPnL),
          pct(p.unrealizedPnLPercent),
          pct(p.investedWeightPercent ?? p.weightPercent),
        ].join(" | "),
      );
    }
    add("");
  }

  if (optionGroups.length > 0) {
    add("## Option positions, grouped by strategy");
    add(
      "Max profit, max loss and break-even are computed from the contract terms; " +
        "use these figures rather than deriving your own.",
    );
    for (const group of optionGroups as OptionGroupDTO[]) {
      const dte = group.expirationDate
        ? daysToExpiration(group.expirationDate, now)
        : null;
      add(
        `- ${group.underlying} ${group.strategy}` +
          (group.expirationDate
            ? ` exp ${group.expirationDate} (${dte} days)`
            : ""),
      );
      add(
        `    legs: ${(group.legs as PositionView[]).map(contractLabel).join(", ")}`,
      );
      add(
        `    net cost ${n(group.netCost)} | value ${n(group.netMarketValue)} | ` +
          `unrealized ${n(group.unrealizedPnL)} | weight ${pct(group.weightPercent)}`,
      );
      add(
        `    max profit ${n(group.maxProfit)} | max loss ${n(group.maxLoss)} | ` +
          `break-even ${group.breakEven === null ? "—" : group.breakEven.toFixed(2)}`,
      );
    }
    add("");
  }

  if (history && history.transactions.length > 0) {
    const recent = history.transactions.slice(0, MAX_TRANSACTIONS);
    add(`## Recent fills (${recent.length} most recent)`);
    add(
      `Bought ${n(history.totals.bought)}, sold ${n(history.totals.sold)}, ` +
        `net ${n(history.totals.netCashFlow)} across ${history.totals.trades} trades.`,
    );
    add(
      "The broker serves roughly 90 days, so anything older is absent — do not " +
        "read this as the full trading history.",
    );
    add("date | side | symbol | qty | price | amount");
    for (const t of recent) {
      add(
        [
          t.tradedAt.slice(0, 10),
          t.side,
          t.symbol,
          t.quantity,
          n(t.price),
          n(t.amount),
        ].join(" | "),
      );
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
