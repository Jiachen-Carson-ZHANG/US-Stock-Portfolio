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

export async function getMarketDataProvider(
  portfolioId: string,
): Promise<MarketDataProvider> {
  return (await activeProvider(portfolioId)) === "moomoo"
    ? new MoomooMarketDataProvider(portfolioId)
    : new MockMarketDataProvider();
}
