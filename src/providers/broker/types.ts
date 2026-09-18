import type {
  AccountSummary,
  BrokerAccount,
  BrokerPosition,
  BrokerTransaction,
} from "@/types/broker";

export interface BrokerProvider {
  getAccounts(): Promise<BrokerAccount[]>;
  getPositions(): Promise<BrokerPosition[]>;
  getAccountSummary(): Promise<AccountSummary>;
  /** Filled orders, newest first. Empty when the broker exposes no history. */
  getTransactions(): Promise<BrokerTransaction[]>;
}
