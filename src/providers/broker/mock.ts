import type {
  AccountSummary,
  BrokerAccount,
  BrokerPosition,
  BrokerTransaction,
} from "@/types/broker";
import type { BrokerProvider } from "./types";
import { MOCK_CASH, MOCK_POSITIONS } from "../mock-portfolio";

export class MockBrokerProvider implements BrokerProvider {
  async getAccounts(): Promise<BrokerAccount[]> {
    return [
      { id: "mock-account-1", broker: "mock", accountMask: "••••4417", currency: "USD" },
    ];
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return MOCK_POSITIONS.map((position) => ({ ...position }));
  }

  async getTransactions(): Promise<BrokerTransaction[]> {
    const day = 86_400_000;
    const now = Date.now();

    return MOCK_POSITIONS.filter((p) => p.instrumentType !== "cash").map(
      (position, index) => ({
        dealId: `mock-fill-${index}`,
        orderId: `mock-order-${index}`,
        side: position.quantity >= 0 ? ("buy" as const) : ("sell" as const),
        symbol: position.symbol,
        name: position.name,
        quantity: Math.abs(position.quantity),
        price: position.averageCost ?? 0,
        amount:
          (position.quantity >= 0 ? -1 : 1) *
          Math.abs(position.quantity) *
          (position.averageCost ?? 0) *
          (position.instrumentType === "option"
            ? (position.contractMultiplier ?? 100)
            : 1),
        tradedAt: new Date(now - (index + 3) * day).toISOString(),
      }),
    );
  }

  async getAccountSummary(): Promise<AccountSummary> {
    return {
      accountId: "mock-account-1",
      currency: "USD",
      cash: MOCK_CASH,
      syncedAt: new Date().toISOString(),
    };
  }
}
