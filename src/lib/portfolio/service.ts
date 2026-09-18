import "server-only";
import { getDb } from "@/lib/db";
import { getMarketDataProvider } from "@/providers";
import { marketSession } from "@/lib/market-hours";
import type {
  AllocationSlice,
  Concentration,
  PortfolioSnapshot,
  PortfolioSummary,
  Position,
  PositionView,
} from "@/types/portfolio";
import {
  allocationByAssetType,
  allocationByPosition,
  allocationBySector,
  buildPositionViews,
  concentration,
  summarize,
} from ".";
import { getQuotes } from "./quotes";
import { lastSyncedAt, readPositions, syncPositions } from "./sync";
import { maybeCreateSnapshot, readSnapshots } from "./snapshots";
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
};

export function baseCurrency(): string {
  return process.env.PORTFOLIO_BASE_CURRENCY ?? "USD";
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
  if (activeProvider() !== "moomoo") return;

  const db = getDb();
  const synced = lastSyncedAt(db);
  if (synced) {
    const age = now.getTime() - new Date(synced).getTime();
    if (age < positionTtlSeconds() * 1000) return;
  }

  try {
    await syncPositions(db, getBrokerProvider(), "moomoo", now);
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
  const db = getDb();
  await ensureFreshPositions(now);
  const stored = readPositions(db);
  if (stored.length === 0) {
    return { positions: [], dataTimestamp: null, isStale: false };
  }

  const { quotes, isStale, dataTimestamp } = await getQuotes(
    db,
    [...new Set(stored.map((p) => p.symbol))],
    getMarketDataProvider(),
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

  return { positions, dataTimestamp, isStale };
}

export async function loadPortfolio(now: Date = new Date()): Promise<PortfolioData> {
  const currency = baseCurrency();
  const { positions, dataTimestamp, isStale } = await pricedPositions(now);

  const summary = summarize(positions, currency, {
    status: marketSession(now),
    dataTimestamp,
    isStale,
  });

  const views = buildPositionViews(positions, currency);

  if (positions.length > 0) {
    maybeCreateSnapshot(getDb(), summary, JSON.stringify(views), now);
  }

  return {
    summary,
    positions: views,
    concentration: concentration(positions, currency),
    allocations: {
      byPosition: allocationByPosition(positions, currency),
      byAssetType: allocationByAssetType(positions, currency),
      bySector: allocationBySector(positions, currency),
    },
  };
}

export async function loadPosition(
  symbol: string,
  now: Date = new Date(),
): Promise<PositionView | null> {
  const { positions } = await loadPortfolio(now);
  return positions.find((p) => p.symbol === symbol) ?? null;
}

export function loadHistory(): PortfolioSnapshot[] {
  return readSnapshots(getDb());
}
