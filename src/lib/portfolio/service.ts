import "server-only";
import { getDb, type DB } from "@/lib/db";
import { getMarketDataProvider } from "@/providers";
import {
  marketSession,
  isAfterMarketClose,
  marketDateString,
} from "@/lib/market-hours";
import type {
  AllocationSlice,
  Concentration,
  Money,
  MoneyDTO,
  PortfolioSnapshot,
  PortfolioSummary,
  Position,
  PositionView,
} from "@/types/portfolio";
import Decimal from "decimal.js";
import {
  allocationByAssetType,
  allocationBySector,
  buildPositionViews,
  concentration,
  costBasis,
  summarize,
} from ".";
import {
  allocationByInvestedCapital,
  groupOptions,
  performanceByAssetClass,
  type AssetClassPerformance,
  toOptionGroupDTO,
  totalInvested,
  type OptionGroupDTO,
} from "./options";
import { money, toDTO } from "@/lib/money";
import { getQuotes } from "./quotes";
import { lastSyncedAt, readPositions, syncPositions } from "./sync";
import { maybeCreateSnapshot, readSnapshots } from "./snapshots";
import { realizedBySymbol } from "./reconstruct";
import {
  lastTransactionSync,
  readTransactions,
  syncTransactions,
  transactionTotals,
  type StoredTransaction,
  type TransactionTotals,
} from "./transactions";
import { activeProvider, getBrokerProvider } from "@/providers";
import { logger } from "@/lib/logger";

export type PortfolioData = {
  summary: PortfolioSummary;
  positions: PositionView[];
  concentration: Concentration;
  allocations: {
    byPosition: AllocationSlice[];
    byAssetType: AllocationSlice[];
    bySector: AllocationSlice[];
  };
  totalInvested: MoneyDTO;
  optionGroups: OptionGroupDTO[];
  byAssetClass: AssetClassPerformance[];
  /** Realized profit per symbol, replayed from the fills. */
  realizedBySymbol: Record<string, number>;
};

export function baseCurrency(): string {
  return process.env.PORTFOLIO_BASE_CURRENCY ?? "USD";
}

/**
 * Total cash paid in, less anything withdrawn.
 *
 * Read from the portfolio's own dated ledger, which reconciles to the cent and
 * — unlike a single environment variable — can describe more than one account.
 * TOTAL_DEPOSITS remains as a fallback for a portfolio whose flows have not
 * been recorded yet, and is otherwise on its way out.
 *
 * Without either, the whole-journey return falls back to the broker's realized
 * P&L, which omits positions closed outright and is therefore too small.
 */
export async function netDeposits(
  db: DB,
  portfolioId: string,
  currency: string,
): Promise<Money | null> {
  const row = await db.get<{ total: string | null }>(
    `SELECT SUM(amount)::text AS total FROM analysis_flows WHERE portfolio_id = ?`,
    [portfolioId],
  );
  const ledger = row?.total === null || row?.total === undefined ? null : Number(row.total);
  if (ledger !== null && Number.isFinite(ledger) && ledger > 0) {
    return money(ledger, currency);
  }

  const raw = process.env.TOTAL_DEPOSITS;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn("config.total_deposits.invalid", { value: raw });
    return null;
  }
  return money(parsed, currency);
}

function positionTtlSeconds(): number {
  return Number(process.env.POSITION_CACHE_SECONDS ?? 30);
}

/**
 * Re-pulls holdings once they age past their TTL (§15). The result is shared,
 * so several family members opening the dashboard together trigger one sync
 * rather than one each. A failure leaves the previous holdings in place.
 */
async function ensureFreshPositions(portfolioId: string, now: Date): Promise<void> {
  if ((await activeProvider(portfolioId)) !== "moomoo") return;

  const db = await getDb();
  const synced = await lastSyncedAt(db, portfolioId);
  if (synced) {
    const age = now.getTime() - new Date(synced).getTime();
    if (age < positionTtlSeconds() * 1000) return;
  }

  try {
    await syncPositions(db, portfolioId, await getBrokerProvider(portfolioId), "moomoo", now);
  } catch (error) {
    logger.error("broker.sync.failure", {
      provider: "moomoo",
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function pricedPositions(portfolioId: string, now: Date): Promise<{
  positions: Position[];
  dataTimestamp: string | null;
  isStale: boolean;
}> {
  const db = await getDb();
  await ensureFreshPositions(portfolioId, now);
  const stored = await readPositions(db, portfolioId);
  if (stored.length === 0) {
    return { positions: [], dataTimestamp: null, isStale: false };
  }

  const { quotes, isStale, dataTimestamp } = await getQuotes(
    db,
    [...new Set(stored.map((p) => p.symbol))],
    await getMarketDataProvider(portfolioId),
    now,
  );

  const positions = stored.map((position) => {
    const quote = quotes.get(position.symbol);
    return {
      ...position,
      // The broker's own mark wins: it is the number shown in their app, and it
      // is consistent with the market value and quantity beside it.
      currentPrice: position.reportedPrice ?? quote?.price,
      previousClose: quote?.previousClose,
    };
  });

  const synced = await lastSyncedAt(db, portfolioId);
  const brokerStale =
    (await activeProvider(portfolioId)) === "moomoo" &&
    (!synced ||
      now.getTime() - new Date(synced).getTime() > positionTtlSeconds() * 1000);
  return { positions, dataTimestamp, isStale: isStale || brokerStale };
}

export async function loadPortfolio(
  portfolioId: string,
  now: Date = new Date(),
): Promise<PortfolioData> {
  const currency = baseCurrency();
  const db = await getDb();
  const { positions, dataTimestamp, isStale } = await pricedPositions(portfolioId, now);

  const summary = summarize(
    positions,
    currency,
    { status: marketSession(now), dataTimestamp, isStale },
    await netDeposits(db, portfolioId, currency),
  );

  const invested = totalInvested(positions, currency);
  const views = buildPositionViews(positions, currency).map((view) => ({
    ...view,
    investedWeightPercent: invested.amount.isZero()
      ? 0
      : new Decimal(costBasis(view).amount)
          .dividedBy(invested.amount)
          .times(100)
          .toNumber(),
  }));

  const brokerMarksAfterClose =
    (await activeProvider(portfolioId)) !== "moomoo" ||
    positions.every((position) => {
      const updated = new Date(position.lastUpdatedAt);
      return (
        Number.isFinite(updated.getTime()) &&
        updated <= now &&
        isAfterMarketClose(updated) &&
        marketDateString(updated) === marketDateString(now)
      );
    });
  if (positions.length > 0 && brokerMarksAfterClose) {
    await maybeCreateSnapshot(db, portfolioId, summary, JSON.stringify(views), now);
  }

  return {
    summary,
    positions: views,
    concentration: concentration(positions, currency),
    allocations: {
      // By capital invested, not current value — a spread counts once at net cost.
      byPosition: allocationByInvestedCapital(positions, currency),
      byAssetType: allocationByAssetType(positions, currency),
      bySector: allocationBySector(positions, currency),
    },
    totalInvested: toDTO(invested),
    optionGroups: groupOptions(positions).groups.map((group) =>
      toOptionGroupDTO(group, invested),
    ),
    byAssetClass: performanceByAssetClass(positions, currency),
    // From the fills, which cover the whole account, rather than the broker's
    // figure, which only covers positions still open.
    realizedBySymbol: Object.fromEntries(
      realizedBySymbol(await readTransactions(db, portfolioId, 5000)),
    ),
  };
}

export async function loadPosition(
  portfolioId: string,
  symbol: string,
  now: Date = new Date(),
): Promise<PositionView | null> {
  const { positions } = await loadPortfolio(portfolioId, now);
  return positions.find((p) => p.symbol === symbol) ?? null;
}

export async function loadHistory(portfolioId: string): Promise<PortfolioSnapshot[]> {
  return readSnapshots(await getDb(), portfolioId);
}

const TRANSACTION_TTL_MS = 15 * 60_000;

/** Fill history changes rarely, so it refreshes on a much slower cadence. */
export async function loadTransactions(
  portfolioId: string,
  now: Date = new Date(),
): Promise<{
  transactions: StoredTransaction[];
  totals: TransactionTotals;
}> {
  const db = await getDb();

  if ((await activeProvider(portfolioId)) === "moomoo") {
    const synced = await lastTransactionSync(db, portfolioId);
    const stale =
      !synced ||
      now.getTime() - new Date(synced).getTime() > TRANSACTION_TTL_MS;

    if (stale) {
      try {
        await syncTransactions(db, portfolioId, await getBrokerProvider(portfolioId), now);
      } catch (error) {
        logger.error("broker.transactions.failure", {
          provider: "moomoo",
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  const transactions = await readTransactions(db, portfolioId);
  return { transactions, totals: transactionTotals(transactions) };
}
