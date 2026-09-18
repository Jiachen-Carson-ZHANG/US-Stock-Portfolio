import type { InstrumentType } from "@/types/portfolio";

/**
 * moomoo identifies a security as {MARKET}.{CODE}. An option encodes its terms
 * in the code itself, e.g. US.AAPL270115C00200000 — root, YYMMDD, C/P, then the
 * strike scaled by 1000.
 */
const OPTION_CODE = /^([A-Z]+)(\d{6})([CP])(\d+)$/;

export type ParsedSymbol = {
  market: string;
  localCode: string;
  instrumentType: InstrumentType;
  underlyingSymbol?: string;
  optionType?: "call" | "put";
  strike?: number;
  expirationDate?: string;
};

function expiryFromYymmdd(value: string): string {
  const year = Number(value.slice(0, 2));
  const century = year >= 70 ? 1900 : 2000;
  return `${century + year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

export function parseSymbol(code: string): ParsedSymbol {
  const separator = code.indexOf(".");
  const market = separator === -1 ? "" : code.slice(0, separator);
  const localCode = separator === -1 ? code : code.slice(separator + 1);

  const option = OPTION_CODE.exec(localCode);
  if (!option) {
    return { market, localCode, instrumentType: "stock" };
  }

  return {
    market,
    localCode,
    instrumentType: "option",
    underlyingSymbol: option[1],
    optionType: option[3] === "P" ? "put" : "call",
    strike: Number(option[4]) / 1000,
    expirationDate: expiryFromYymmdd(option[2]),
  };
}

/**
 * Market value already accounts for the contract multiplier, so deriving it
 * from the broker's own numbers avoids hardcoding 100 and silently mispricing
 * any contract that does not use it.
 */
export function deriveContractMultiplier(params: {
  quantity: number;
  price: number;
  marketValue: number;
}): number {
  const { quantity, price, marketValue } = params;
  if (quantity === 0 || price === 0 || !Number.isFinite(marketValue)) return 100;

  const ratio = Math.abs(marketValue / (quantity * price));
  if (!Number.isFinite(ratio) || ratio <= 0) return 100;

  const rounded = Math.round(ratio);
  return rounded > 0 ? rounded : 100;
}
