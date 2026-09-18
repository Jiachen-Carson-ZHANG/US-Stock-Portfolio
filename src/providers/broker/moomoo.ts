import type {
  AccountSummary,
  BrokerAccount,
  BrokerPosition,
  BrokerTransaction,
} from "@/types/broker";
import type { BrokerProvider } from "./types";
import { getDb } from "@/lib/db";
import { moomooGet } from "@/lib/moomoo/client";
import { readConnection, setAccountId } from "@/lib/moomoo/tokens";
import { deriveContractMultiplier, parseSymbol } from "@/lib/moomoo/symbols";

type MoomooAccount = {
  // uint64, routinely beyond Number.MAX_SAFE_INTEGER — the client keeps it as
  // an exact string so the ID is not silently rounded into a different account.
  account_id: string;
  security_firm: string;
  acc_type: string;
  account_card_number?: string;
};

type MoomooPosition = {
  position_side: string;
  code: string;
  stock_name: string;
  qty: string;
  currency: string;
  nominal_price: string;
  cost_price: string;
  cost_price_valid: boolean;
  market_val: string;
  unrealized_pl: string;
  realized_pl: string;
  today_pl_val: string;
};

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type MoomooFunds = {
  cash: string;
  currency: string;
  total_assets: string;
  market_val: string;
};

type MoomooFillsPage = {
  order_fills: {
    trd_side: string;
    deal_id: string;
    order_id: string;
    code: string;
    stock_name: string;
    qty: string;
    price: string;
    create_time: number | string;
  }[];
  page_flag: string;
  completed: boolean;
};

const MAX_HISTORY_PAGES = 20;
const DEFAULT_OPTION_MULTIPLIER = 100;

const BASE_CURRENCY = () => process.env.PORTFOLIO_BASE_CURRENCY ?? "USD";

export class MoomooBrokerProvider implements BrokerProvider {
  async getAccounts(): Promise<BrokerAccount[]> {
    const data = await moomooGet<{ accounts: MoomooAccount[] }>(
      "/api/v1.0/accounts/authorized_trd_accs",
    );

    return data.accounts.map((account) => ({
      id: String(account.account_id),
      broker: "moomoo" as const,
      accountMask: account.account_card_number
        ? `••••${account.account_card_number.slice(-4)}`
        : "••••",
      currency: BASE_CURRENCY(),
    }));
  }

  /** Resolves the account once and remembers it, so sync is a single call path. */
  private async accountId(): Promise<string> {
    const db = getDb();
    const stored = readConnection(db)?.accountId;
    if (stored) return stored;

    const accounts = await this.getAccounts();
    if (accounts.length === 0) {
      throw new Error("No authorized moomoo trading account is available.");
    }

    setAccountId(db, accounts[0].id);
    return accounts[0].id;
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const accountId = await this.accountId();

    const [rows, funds] = await Promise.all([
      moomooGet<MoomooPosition[]>(`/api/v1.0/accounts/${accountId}/positions`),
      this.getFunds(accountId),
    ]);

    const positions: BrokerPosition[] = rows
      .filter((row) => Number(row.qty) !== 0)
      .map((row) => {
        const parsed = parseSymbol(row.code);
        const quantity = Number(row.qty);
        const price = Number(row.nominal_price);

        const base: BrokerPosition = {
          symbol: parsed.localCode,
          name: row.stock_name,
          instrumentType: parsed.instrumentType,
          quantity,
          averageCost: row.cost_price_valid ? Number(row.cost_price) : 0,
          currency: row.currency || BASE_CURRENCY(),
          // Taken verbatim: moomoo nets realized proceeds against cost, so these
          // are the only figures that reconcile with the account itself.
          reportedPrice: numberOrUndefined(row.nominal_price),
          reportedMarketValue: numberOrUndefined(row.market_val),
          reportedUnrealizedPnL: numberOrUndefined(row.unrealized_pl),
          reportedTodayPnL: numberOrUndefined(row.today_pl_val),
          reportedRealizedPnL: numberOrUndefined(row.realized_pl),
        };

        if (parsed.instrumentType !== "option") return base;

        return {
          ...base,
          underlyingSymbol: parsed.underlyingSymbol,
          optionType: parsed.optionType,
          strike: parsed.strike,
          expirationDate: parsed.expirationDate,
          contractMultiplier: deriveContractMultiplier({
            quantity,
            price,
            marketValue: Number(row.market_val),
          }),
        };
      });

    const cash = Number(funds.cash);
    if (Number.isFinite(cash) && cash !== 0) {
      positions.push({
        symbol: `${funds.currency || BASE_CURRENCY()}.CASH`,
        name: "Cash",
        instrumentType: "cash",
        quantity: cash,
        averageCost: 1,
        currency: funds.currency || BASE_CURRENCY(),
      });
    }

    return positions;
  }

  private async getFunds(accountId: string): Promise<MoomooFunds> {
    return moomooGet<MoomooFunds>(
      `/api/v1.0/accounts/${accountId}/funds?currency=${encodeURIComponent(BASE_CURRENCY())}`,
    );
  }

  /**
   * Walks moomoo's paginated fill history. Without start/end it returns the
   * last 90 days, which is the window the API defaults to.
   */
  async getTransactions(): Promise<BrokerTransaction[]> {
    const accountId = await this.accountId();
    const fills: BrokerTransaction[] = [];
    let pageFlag = "";

    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const query = new URLSearchParams({
        trd_market: process.env.MOOMOO_MARKET ?? "US",
        page_flag: pageFlag,
        page_size: "50",
      });

      const data = await moomooGet<MoomooFillsPage>(
        `/api/v1.0/accounts/${accountId}/fills_history?${query}`,
      );

      for (const fill of data.order_fills ?? []) {
        const parsed = parseSymbol(fill.code);
        const quantity = Math.abs(Number(fill.qty));
        const price = Number(fill.price);
        // moomoo distinguishes SELL from SELL_SHORT, and BUY from BUY_BACK;
        // both sells reduce exposure and both buys add to it.
        const side = fill.trd_side?.toUpperCase().startsWith("SELL")
          ? "sell"
          : "buy";

        // An option fill is quoted per share but traded per contract, so the
        // cash moved is 100x the quantity times price.
        const multiplier =
          parsed.instrumentType === "option" ? DEFAULT_OPTION_MULTIPLIER : 1;

        fills.push({
          dealId: fill.deal_id,
          orderId: fill.order_id,
          side,
          symbol: parsed.localCode,
          name: fill.stock_name,
          quantity,
          price,
          amount: (side === "buy" ? -1 : 1) * quantity * price * multiplier,
          // moomoo timestamps are microseconds.
          tradedAt: new Date(Number(fill.create_time) / 1000).toISOString(),
        });
      }

      if (data.completed || !data.page_flag) break;
      pageFlag = data.page_flag;
    }

    return fills;
  }

  async getAccountSummary(): Promise<AccountSummary> {
    const accountId = await this.accountId();
    const funds = await this.getFunds(accountId);

    return {
      accountId,
      currency: funds.currency || BASE_CURRENCY(),
      cash: Number(funds.cash),
      syncedAt: new Date().toISOString(),
    };
  }
}
