import type { AccountSummary, BrokerAccount, BrokerPosition } from "@/types/broker";
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

  async getAccountSummary(): Promise<AccountSummary> {
    return {
      accountId: "mock-account-1",
      currency: "USD",
      cash: MOCK_CASH,
      syncedAt: new Date().toISOString(),
    };
  }
}
