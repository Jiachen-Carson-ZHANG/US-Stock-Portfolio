import type { BrokerProvider } from "./broker/types";
import type { MarketDataProvider } from "./market-data/types";
import { MockBrokerProvider } from "./broker/mock";
import { MockMarketDataProvider } from "./market-data/mock";

export type ProviderName = "mock" | "moomoo";

export function activeProvider(): ProviderName {
  return process.env.DATA_PROVIDER === "moomoo" ? "moomoo" : "mock";
}

function notImplemented(): never {
  throw new Error(
    "The Moomoo provider is not implemented yet. Run with DATA_PROVIDER=mock.",
  );
}

export function getBrokerProvider(): BrokerProvider {
  return activeProvider() === "moomoo" ? notImplemented() : new MockBrokerProvider();
}

export function getMarketDataProvider(): MarketDataProvider {
  return activeProvider() === "moomoo"
    ? notImplemented()
    : new MockMarketDataProvider();
}
