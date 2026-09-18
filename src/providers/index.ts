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
export async function activeProvider(): Promise<ProviderName> {
  if (process.env.DATA_PROVIDER === "moomoo") return "moomoo";
  return (await hasBrokerConnection()) ? "moomoo" : "mock";
}

async function hasBrokerConnection(): Promise<boolean> {
  try {
    return (await readConnectionStatus(await getDb())) !== null;
  } catch {
    return false;
  }
}

export async function getBrokerProvider(): Promise<BrokerProvider> {
  return (await activeProvider()) === "moomoo"
    ? new MoomooBrokerProvider()
    : new MockBrokerProvider();
}

export async function getMarketDataProvider(): Promise<MarketDataProvider> {
  return (await activeProvider()) === "moomoo"
    ? new MoomooMarketDataProvider()
    : new MockMarketDataProvider();
}
