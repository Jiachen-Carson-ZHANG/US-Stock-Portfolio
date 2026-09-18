import type { BrokerPosition } from "@/types/broker";

export const MOCK_CASH = 18_450.0;

/** Synthetic holdings from spec §34. Never replace these with real holdings. */
export const MOCK_POSITIONS: BrokerPosition[] = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    instrumentType: "stock",
    quantity: 150,
    averageCost: 178.32,
    currency: "USD",
    sector: "Technology",
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc. Class A",
    instrumentType: "stock",
    quantity: 80,
    averageCost: 141.5,
    currency: "USD",
    sector: "Communication Services",
  },
  {
    symbol: "VST",
    name: "Vistra Corp.",
    instrumentType: "stock",
    quantity: 200,
    averageCost: 62.1,
    currency: "USD",
    sector: "Utilities",
  },
  {
    symbol: "RBLX",
    name: "Roblox Corporation",
    instrumentType: "stock",
    quantity: 120,
    averageCost: 45.8,
    currency: "USD",
    sector: "Communication Services",
  },
  {
    symbol: "AAPL270115C00200000",
    underlyingSymbol: "AAPL",
    name: "AAPL 15 Jan 2027 200 Call",
    instrumentType: "option",
    quantity: 2,
    averageCost: 12.4,
    currency: "USD",
    optionType: "call",
    strike: 200,
    expirationDate: "2027-01-15",
    contractMultiplier: 100,
  },
  {
    symbol: "USD.CASH",
    name: "Cash",
    instrumentType: "cash",
    quantity: MOCK_CASH,
    averageCost: 1,
    currency: "USD",
  },
];

export const MOCK_PRICES: Record<string, { price: number; previousClose: number }> = {
  AAPL: { price: 195.2, previousClose: 193.1 },
  GOOGL: { price: 152.75, previousClose: 154.2 },
  VST: { price: 78.4, previousClose: 76.9 },
  RBLX: { price: 41.15, previousClose: 41.8 },
  AAPL270115C00200000: { price: 18.65, previousClose: 17.9 },
  "USD.CASH": { price: 1, previousClose: 1 },
};
