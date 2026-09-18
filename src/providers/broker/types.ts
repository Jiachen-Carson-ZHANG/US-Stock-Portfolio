import type { AccountSummary, BrokerAccount, BrokerPosition } from "@/types/broker";

export interface BrokerProvider {
  getAccounts(): Promise<BrokerAccount[]>;
  getPositions(): Promise<BrokerPosition[]>;
  getAccountSummary(): Promise<AccountSummary>;
}
