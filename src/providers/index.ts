import type { BrokerProvider } from "./broker/types";
import type { MarketDataProvider } from "./market-data/types";
import { MockBrokerProvider } from "./broker/mock";
import { MockMarketDataProvider } from "./market-data/mock";
import { MoomooBrokerProvider } from "./broker/moomoo";
import { MoomooMarketDataProvider } from "./market-data/moomoo";
import { getDb } from "@/lib/db";
import { readConnectionStatus } from "@/lib/moomoo/tokens";

export type ProviderName = "mock" | "moomoo";

/**
 * A live broker connection wins over the env default, so connecting an account
 * switches quotes and holdings over immediately. Otherwise the app would sit in
 * a half-state: real positions priced by the mock quote feed.
 */
export async function activeProvider(portfolioId: string): Promise<ProviderName> {
  if (process.env.DATA_PROVIDER === "moomoo") return "moomoo";
  return (await hasBrokerConnection(portfolioId)) ? "moomoo" : "mock";
}

async function hasBrokerConnection(portfolioId: string): Promise<boolean> {
  try {
    return (await readConnectionStatus(await getDb(), portfolioId)) !== null;
  } catch {
    return false;
  }
}

export async function getBrokerProvider(
  portfolioId: string,
): Promise<BrokerProvider> {
  return (await activeProvider(portfolioId)) === "moomoo"
    ? new MoomooBrokerProvider(portfolioId)
    : new MockBrokerProvider();
}

/**
 * Whose connection pays for a quote.
 *
 * A price is not private — NVDA costs the same for everybody — but asking
 * moomoo for one still spends somebody's token. A mock account has no
 * connection of its own, and its entire promise is practice money against
 * real prices, so it borrows a connection that exists rather than falling
 * back to invented numbers.
 *
 * This is where placing an order on a simulated account used to fail. With
 * DATA_PROVIDER set to moomoo, every portfolio was handed a moomoo quote
 * client pointed at its own id; a mock portfolio has no token under that id,
 * so the request threw and the screen said only "Could not place the order."
 * The displayed price still looked fine because that came from the shared
 * quote cache, which made it look like the feed was working.
 *
 * Only the public price feed is borrowed. Holdings, cash and orders are never
 * read through somebody else's connection.
 */
async function quoteConnectionFor(portfolioId: string): Promise<string | null> {
  if (portfolioId && (await hasBrokerConnection(portfolioId))) return portfolioId;

  try {
    const db = await getDb();
    const row = await db.get<{ portfolio_id: string | null }>(
      `SELECT portfolio_id FROM broker_connections
        WHERE provider = 'moomoo' AND status = 'connected' AND portfolio_id IS NOT NULL
        ORDER BY connected_at DESC
        LIMIT 1`,
    );
    return row?.portfolio_id ?? null;
  } catch {
    return null;
  }
}

export async function getMarketDataProvider(
  portfolioId: string,
): Promise<MarketDataProvider> {
  const connection = await quoteConnectionFor(portfolioId);
  return connection
    ? new MoomooMarketDataProvider(connection)
    : new MockMarketDataProvider();
}
