import "server-only";
import { getDb } from "@/lib/db";
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
};

export function baseCurrency(): string {
  return process.env.PORTFOLIO_BASE_CURRENCY ?? "USD";
}

/**
 * Total cash paid into the broker account, less anything withdrawn. Set it and
 * the whole-journey return is measured against what was actually contributed
 * rather than inferred from the broker's realized P&L, which omits positions
 * closed outright. Unset, the app falls back to that inference.
 */
export function netDeposits(currency: string): Money | null {
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
  return Number(process.env.POSITION_CACHE_SECONDS ?? 60);
}

/**
 * Re-pulls holdings once they age past their TTL (§15). The result is shared,
 * so several family members opening the dashboard together trigger one sync
 * rather than one each. A failure leaves the previous holdings in place.
 */
async function ensureFreshPositions(now: Date): Promise<void> {
  if ((await activeProvider()) !== "moomoo") return;

  const db = await getDb();
  const synced = await lastSyncedAt(db);
  if (synced) {
    const age = now.getTime() - new Date(synced).getTime();
    if (age < positionTtlSeconds() * 1000) return;
  }

  try {
    await syncPositions(db, await getBrokerProvider(), "moomoo", now);
  } catch (error) {
    logger.error("broker.sync.failure", {
      provider: "moomoo",
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function pricedPositions(now: Date): Promise<{
  positions: Position[];
  dataTimestamp: string | null;
  isStale: boolean;
}> {
  const db = await getDb();
  await ensureFreshPositions(now);
  const stored = await readPositions(db);
  if (stored.length === 0) {
    return { positions: [], dataTimestamp: null, isStale: false };
  }

  const { quotes, isStale, dataTimestamp } = await getQuotes(
    db,
    [...new Set(stored.map((p) => p.symbol))],
    await getMarketDataProvider(),
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

  const synced = await lastSyncedAt(db);
  const brokerStale =
    (await activeProvider()) === "moomoo" &&
    (!synced ||
      now.getTime() - new Date(synced).getTime() > positionTtlSeconds() * 1000);
  return { positions, dataTimestamp, isStale: isStale || brokerStale };
}

export async function loadPortfolio(
  now: Date = new Date(),
): Promise<PortfolioData> {
  const currency = baseCurrency();
  const { positions, dataTimestamp, isStale } = await pricedPositions(now);

  const summary = summarize(
    positions,
    currency,
    { status: marketSession(now), dataTimestamp, isStale },
    netDeposits(currency),
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
    (await activeProvider()) !== "moomoo" ||
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
    await maybeCreateSnapshot(await getDb(), summary, JSON.stringify(views), now);
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
  };
}

export async function loadPosition(
  symbol: string,
  now: Date = new Date(),
): Promise<PositionView | null> {
  const { positions } = await loadPortfolio(now);
  return positions.find((p) => p.symbol === symbol) ?? null;
}

export async function loadHistory(): Promise<PortfolioSnapshot[]> {
  return readSnapshots(await getDb());
}

const TRANSACTION_TTL_MS = 15 * 60_000;

/** Fill history changes rarely, so it refreshes on a much slower cadence. */
export async function loadTransactions(now: Date = new Date()): Promise<{
  transactions: StoredTransaction[];
  totals: TransactionTotals;
}> {
  const db = await getDb();

  if ((await activeProvider()) === "moomoo") {
    const synced = await lastTransactionSync(db);
    const stale =
      !synced ||
      now.getTime() - new Date(synced).getTime() > TRANSACTION_TTL_MS;

    if (stale) {
      try {
        await syncTransactions(db, await getBrokerProvider(), now);
      } catch (error) {
        logger.error("broker.transactions.failure", {
          provider: "moomoo",
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  const transactions = await readTransactions(db);
  return { transactions, totals: transactionTotals(transactions) };
}
