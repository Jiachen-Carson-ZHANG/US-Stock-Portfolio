import "server-only";
import { observe } from "@/lib/observe";
import { getDb, type DB } from "@/lib/db";
import { dedupe } from "@/lib/inflight";
import { DEFAULT_SLUG, findById, listPortfolios, type Portfolio } from "@/lib/portfolios";
import { mockState, syncMockPositions } from "./mock";
import { matchOpenOrders, openOrders } from "@/lib/trading/orders";
import type { OptionGreeks, Quote } from "@/types/market";
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
  buildPositionViews,
  concentration,
  costBasis,
  summarize,
} from ".";
import {
  allocationByAssetTypeAtCost,
  allocationByInvestedCapital,
  allocationBySectorAtCost,
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
import { realizedFor } from "./realized-cache";
import { underlyingCostPrices } from "./underlying-cost";
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
  /**
   * The broker's own risk figures per option contract — implied volatility,
   * delta, theta. Passed through rather than re-derived: the market quoted
   * the price with these numbers, so anything built on top of them agrees
   * with the broker's own screen.
   */
  optionGreeks: Record<string, OptionGreeks>;
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
  portfolio: Portfolio,
  currency: string,
): Promise<Money | null> {
  const row = await db.get<{ total: string | null }>(
    `SELECT SUM(amount)::text AS total FROM analysis_flows WHERE portfolio_id = ?`,
    [portfolio.id],
  );
  const ledger = row?.total === null || row?.total === undefined ? null : Number(row.total);

  // A mock account starts from a stated balance. That balance is its
  // deposit, and any later transfer adds to it.
  if (portfolio.kind === "mock") {
    const opening = Number(portfolio.openingCash ?? "0");
    const total = (Number.isFinite(opening) ? opening : 0) + (ledger ?? 0);
    return total > 0 ? money(total, currency) : null;
  }

  if (ledger !== null && Number.isFinite(ledger) && ledger > 0) {
    return money(ledger, currency);
  }

  // TOTAL_DEPOSITS describes one account — the original one — and applying
  // it to every portfolio that has no ledger yet is how a brand-new mock
  // account came to report $22,100 paid in and a $12,100 loss on its first
  // day. It is on its way out; until then it is scoped to where it is true.
  if (portfolio.slug !== DEFAULT_SLUG) return null;

  const raw = process.env.TOTAL_DEPOSITS;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn("config.total_deposits.invalid", { value: raw });
    return null;
  }
  return money(parsed, currency);
}

/**
 * The first day this portfolio has any record of — a transfer in, or the
 * earliest valuation.
 *
 * Two queries and a comparison rather than one clever SELECT: the previous
 * version reused a positional parameter inside two subqueries wrapped in
 * LEAST, which is exactly the kind of thing that quietly returns null and
 * leaves a card with no date under it.
 */
export async function portfolioStart(
  db: DB,
  portfolioId: string,
): Promise<string | null> {
  const [flow, snapshot] = await Promise.all([
    db.get<{ date: string | null }>(
      `SELECT MIN(date) AS date FROM analysis_flows WHERE portfolio_id = ?`,
      [portfolioId],
    ),
    db.get<{ date: string | null }>(
      `SELECT MIN(snapshot_date) AS date FROM portfolio_snapshots WHERE portfolio_id = ?`,
      [portfolioId],
    ),
  ]);

  const dates = [flow?.date, snapshot?.date].filter(
    (date): date is string => typeof date === "string" && date.length > 0,
  );
  return dates.length > 0 ? dates.sort()[0] : null;
}

/**
 * How stale holdings may get before a page load waits for them.
 *
 * Between the cache TTL and this, the page renders from what is stored and
 * the refresh runs behind it — three moomoo round trips (accounts, positions,
 * funds) is a long time to hold a render for numbers that only move when
 * somebody trades.
 *
 * Raised from five minutes to half an hour. Five meant that coming back to
 * the site after lunch made the first page you opened wait for the broker,
 * which read as "this site is slow" rather than "these holdings are eleven
 * minutes old". Holdings change on a trade, not on a tick: the prices beside
 * them still refresh every five seconds, the header still says when the
 * holdings were last pulled, and Sync holdings now is there for the moment
 * after you trade in the moomoo app itself.
 */
const STALE_POSITIONS_MS = 30 * 60_000;

/** The longest a page may wait for holdings before rendering what it has. */
const BLOCKING_SYNC_DEADLINE_MS = 6_000;

function positionTtlSeconds(): number {
  return Number(process.env.POSITION_CACHE_SECONDS ?? 30);
}

/**
 * Re-pulls holdings once they age past their TTL (§15). The result is shared,
 * so several family members opening the dashboard together trigger one sync
 * rather than one each. A failure leaves the previous holdings in place.
 */
export async function ensureFreshPositions(portfolioId: string, now: Date): Promise<void> {
  const db = await getDb();

  // A mock portfolio has no broker to ask. Its holdings are the replay of
  // its own trades, rewritten into the same table the broker sync uses so
  // every page downstream cannot tell the difference.
  const portfolio = await findById(db, portfolioId);
  if (portfolio?.kind === "mock") {
    const { holdings } = await mockState(db, portfolio);
    // Resting orders need a price too, and for symbols that are not held yet
    // — that is the whole point of a limit order to open a position.
    const resting = await openOrders(db, portfolio.id);
    const symbols = [
      ...new Set([
        ...[...holdings].filter(([, lot]) => !lot.quantity.isZero()).map(([symbol]) => symbol),
        ...resting.map((order) => order.symbol),
      ]),
    ];

    const { quotes } = symbols.length
      ? await getQuotes(db, symbols, await getMarketDataProvider(portfolioId), now)
      : { quotes: new Map<string, Quote>() };

    // One of the moments a resting order gets looked at. The scheduler calling
    // matchAllRestingOrders is the other, and the one that matters when nobody
    // is watching. Orders record when they were last checked either way, so
    // the screen can say when rather than imply it is continuous.
    if (resting.length > 0) await matchOpenOrders(db, portfolio, quotes, now);

    await syncMockPositions(db, portfolio, quotes, now);
    return;
  }

  if ((await activeProvider(portfolioId)) !== "moomoo") return;

  const synced = await lastSyncedAt(db, portfolioId);
  if (synced) {
    const age = now.getTime() - new Date(synced).getTime();
    if (age < positionTtlSeconds() * 1000) return;
  }

  // Holdings change on a trade, not on a tick, so a render does not wait for
  // them. Past the window below the page would be showing something old
  // enough to mislead, and then it does wait.
  const age = synced ? now.getTime() - new Date(synced).getTime() : Infinity;
  const blocking = age > STALE_POSITIONS_MS;

  const work = dedupe(`positions:${portfolioId}`, async () => {
    await syncPositions(db, portfolioId, await getBrokerProvider(portfolioId), "moomoo", now);
  }).catch((error: unknown) => {
    logger.error("broker.sync.failure", {
      provider: "moomoo",
      reason: error instanceof Error ? error.message : "unknown",
    });
  });

  // Even when it blocks, it blocks for a stated length of time. Three broker
  // round trips at eight seconds each is twenty-four seconds of a page doing
  // nothing, which nobody waits through — past this the stored holdings are
  // rendered, the sync finishes in the background, and the next load has it.
  // Nothing on this site is allowed to wait indefinitely for somebody else's
  // server.
  if (blocking) {
    await Promise.race([
      work,
      new Promise<void>((resolve) => setTimeout(resolve, BLOCKING_SYNC_DEADLINE_MS)),
    ]);
  }
}

async function pricedPositions(portfolioId: string, now: Date): Promise<{
  positions: Position[];
  quotes: Map<string, Quote>;
  dataTimestamp: string | null;
  isStale: boolean;
}> {
  const db = await getDb();
  await ensureFreshPositions(portfolioId, now);
  const stored = await readPositions(db, portfolioId);
  if (stored.length === 0) {
    return { positions: [], quotes: new Map(), dataTimestamp: null, isStale: false };
  }

  // The underlying share price is asked for alongside the contracts. An
  // option's break-even is a share price, so it only means something next to
  // where the share actually trades — and the underlying is usually not held
  // itself, so nothing else would have fetched it.
  const symbols = [
    ...new Set([
      ...stored.map((p) => p.symbol),
      ...stored.flatMap((p) =>
        p.instrumentType === "option" && p.underlyingSymbol ? [p.underlyingSymbol] : [],
      ),
    ]),
  ];

  const { quotes, isStale, dataTimestamp } = await getQuotes(
    db,
    symbols,
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

  const [synced, provider] = await Promise.all([
    lastSyncedAt(db, portfolioId),
    activeProvider(portfolioId),
  ]);
  const brokerStale =
    provider === "moomoo" &&
    (!synced ||
      now.getTime() - new Date(synced).getTime() > positionTtlSeconds() * 1000);
  return { positions, quotes, dataTimestamp, isStale: isStale || brokerStale };
}

/**
 * The same answer for everybody looking at the same account.
 *
 * Thirty people with the dashboard open is thirty requests every five
 * seconds, and every one of them was recomputing the identical portfolio
 * from scratch — the same rows, the same prices, the same arithmetic. They
 * are all looking at the same account, so there is no reason for more than
 * one of them to do the work.
 *
 * Two seconds, deliberately shorter than the five-second poll, so nobody
 * ever sees a figure older than they would have seen anyway. What this
 * removes is duplicated effort, not freshness.
 */
const RECOMPUTE_WINDOW_MS = 2_000;

const recent = new Map<string, { at: number; data: Promise<PortfolioData> }>();

export async function loadPortfolio(
  portfolioId: string,
  now: Date = new Date(),
): Promise<PortfolioData> {
  const cached = recent.get(portfolioId);
  if (cached && Date.now() - cached.at < RECOMPUTE_WINDOW_MS) return cached.data;

  const data = observe("portfolio.load", null, () => loadPortfolioInner(portfolioId, now));
  recent.set(portfolioId, { at: Date.now(), data });

  // A failure must not be remembered, or one bad moment becomes two seconds
  // of everybody being handed the same error.
  data.catch(() => recent.delete(portfolioId));

  // Keyed by portfolio, and there are only ever a handful — but a long-lived
  // instance should not hold results forever.
  if (recent.size > 50) {
    for (const [key, value] of recent) {
      if (Date.now() - value.at > RECOMPUTE_WINDOW_MS) recent.delete(key);
    }
  }

  return data;
}

async function loadPortfolioInner(
  portfolioId: string,
  now: Date,
): Promise<PortfolioData> {
  const currency = baseCurrency();
  const db = await getDb();
  const portfolio = await findById(db, portfolioId);
  if (!portfolio) throw new Error(`No portfolio ${portfolioId}`);

  // Three independent reads: holdings, money paid in, and realized gains.
  // None needs another's answer, so they go to the database at the same time
  // rather than one after another. Sitting beside the database that saves
  // milliseconds; across an ocean it saves two full round trips per page.
  const [{ positions, quotes, dataTimestamp, isStale }, deposits, realized] = await Promise.all([
    pricedPositions(portfolioId, now),
    netDeposits(db, portfolio, currency),
    // From the fills, which cover the whole account, rather than the broker's
    // figure, which only covers positions still open. Cached against a
    // fingerprint of the fill list, so the replay runs when a trade changes
    // rather than on every page view.
    realizedFor(db, portfolioId),
  ]);

  const summary = summarize(
    positions,
    currency,
    { status: marketSession(now), dataTimestamp, isStale },
    deposits,
  );

  const invested = totalInvested(positions, currency);
  const groups = groupOptions(positions).groups;

  // Where each underlying was trading when its contracts were bought. Daily
  // closes, cached for the day, so this is one broker call per underlying
  // however many people open the page.
  const underlyingCost = await underlyingCostPrices(
    db,
    portfolioId,
    groups,
    await getMarketDataProvider(portfolioId),
  ).catch(() => ({}) as Record<string, number>);
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
      // By what was committed, not what it is quoted at — see
      // allocationByAssetTypeAtCost. Face value counted a spread's long leg
      // at full notional and dropped its short, which is how options showed
      // as 65% of a portfolio they are a third of.
      byAssetType: allocationByAssetTypeAtCost(positions, currency),
      bySector: allocationBySectorAtCost(positions, currency),
    },
    totalInvested: toDTO(invested),
    optionGroups: groups.map((group) =>
      toOptionGroupDTO(
        group,
        invested,
        quotes.get(group.underlying)?.price,
        underlyingCost[group.underlying],
      ),
    ),
    byAssetClass: performanceByAssetClass(positions, currency, realized),
    // From the fills, which cover the whole account, rather than the broker's
    // figure, which only covers positions still open.
    realizedBySymbol: realized,
    optionGreeks: Object.fromEntries(
      positions.flatMap((position) => {
        if (position.instrumentType !== "option") return [];
        const greeks = quotes.get(position.symbol)?.greeks;
        return greeks ? [[position.symbol, greeks] as const] : [];
      }),
    ),
  };
}

/**
 * Fills resting orders for every simulated account, with nobody signed in.
 *
 * Until now an order was only looked at when somebody happened to load the
 * page it was resting on. Leave a limit order overnight and it would sit
 * there untouched while the price traded straight through it, then fill the
 * next morning at whatever the price had become — which is not a limit order,
 * it is a lottery. A scheduler calls this every minute so the market being
 * reached is what fills an order, not somebody opening a browser tab.
 *
 * Only accounts that actually have something resting are touched, so a
 * hundred idle accounts cost one query rather than a hundred quote requests.
 */
export async function matchAllRestingOrders(
  now: Date = new Date(),
): Promise<{ accounts: number; orders: number }> {
  const db = await getDb();
  let accounts = 0;
  let orders = 0;

  for (const portfolio of await listPortfolios(db)) {
    if (portfolio.kind !== "mock") continue;
    const resting = await openOrders(db, portfolio.id);
    if (resting.length === 0) continue;

    accounts += 1;
    orders += resting.length;
    try {
      // The whole refresh rather than matching alone: a fill changes the
      // holdings, and the holdings have to be rewritten with prices for every
      // symbol held, not only the ones an order named.
      await loadPortfolio(portfolio.id, now);
    } catch (error) {
      // One account with a broken quote feed must not stop the rest.
      logger.error("orders.match.failure", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return { accounts, orders };
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
  return observe("portfolio.transactions", null, () =>
    loadTransactionsInner(portfolioId, now),
  );
}

async function loadTransactionsInner(
  portfolioId: string,
  now: Date,
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
