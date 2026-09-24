/**
 * What the broker knows about a symbol, organised the way a trading screen
 * shows it.
 *
 * Built from the snapshot moomoo sends, kept whole in the quote cache. The
 * field names below are moomoo's own — confirmed against a real snapshot
 * rather than guessed, which is how the first attempt at option greeks came
 * back empty for every contract.
 *
 * Pure and shared, because the server builds it for the page and the browser
 * rebuilds it when a price refreshes. Anything absent or zero is left out
 * rather than shown as "0": a P/E of zero is not a P/E, it is a field that
 * does not apply.
 */
export type ExtendedSession = { price: number; change: number; changePercent: number };

export type QuoteDetail = {
  symbol: string;
  name?: string;
  /** The simplified-Chinese name moomoo publishes. Far better than any map. */
  nameZh?: string;
  price?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;

  open?: number;
  high?: number;
  low?: number;
  high52?: number;
  low52?: number;
  averagePrice?: number;
  amplitude?: number;

  volume?: number;
  turnover?: number;
  turnoverRate?: number;
  volumeRatio?: number;

  bid?: number;
  bidSize?: number;
  ask?: number;
  askSize?: number;

  marketCap?: number;
  peTtm?: number;
  pb?: number;
  eps?: number;
  dividendYield?: number;
  sharesOutstanding?: number;

  preMarket?: ExtendedSession;
  afterHours?: ExtendedSession;
  overnight?: ExtendedSession;

  option?: {
    type?: "call" | "put";
    strike?: number;
    daysToExpiry?: number;
    style?: string;
    multiplier?: number;
    impliedVolatility?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    rho?: number;
    openInterest?: number;
    notional?: number;
  };
};

type Raw = Record<string, unknown>;

/** A number worth showing: finite and not the zero moomoo uses for "none". */
function num(raw: Raw, key: string): number | undefined {
  const value = raw[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
}

function text(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 && value !== "N/A" ? value : undefined;
}

/**
 * An extended-hours price, but only if it traded.
 *
 * moomoo fills these fields with zero outside their session, and a pre-market
 * "price" of zero is not a crash to report.
 */
function extended(raw: Raw, prefix: "pre" | "after" | "overnight"): ExtendedSession | undefined {
  const price = num(raw, `${prefix}_price`);
  if (price === undefined) return undefined;
  return {
    price,
    change: (raw[`${prefix}_change_val`] as number) ?? 0,
    changePercent: (raw[`${prefix}_change_rate`] as number) ?? 0,
  };
}

export function quoteDetail(symbol: string, raw: Raw | undefined): QuoteDetail {
  if (!raw) return { symbol };

  const price = num(raw, "last_price");
  const previousClose = num(raw, "prev_close_price");
  const isOption = raw.option_valid === true || raw.option_valid === "True";

  // Implied volatility arrives as a percentage (87.3), wanted as a fraction.
  const iv = num(raw, "option_implied_volatility");

  const optionType = text(raw, "option_type")?.toLowerCase();

  return {
    symbol,
    name: text(raw, "name"),
    nameZh: text(raw, "sc_name"),
    price,
    previousClose,
    change: price !== undefined && previousClose !== undefined ? price - previousClose : undefined,
    changePercent:
      price !== undefined && previousClose ? ((price - previousClose) / previousClose) * 100 : undefined,

    open: num(raw, "open_price"),
    high: num(raw, "high_price"),
    low: num(raw, "low_price"),
    high52: num(raw, "highest52weeks_price"),
    low52: num(raw, "lowest52weeks_price"),
    averagePrice: isOption ? undefined : num(raw, "avg_price"),
    amplitude: num(raw, "amplitude"),

    volume: num(raw, "volume"),
    turnover: num(raw, "turnover"),
    turnoverRate: num(raw, "turnover_rate"),
    volumeRatio: num(raw, "volume_ratio"),

    bid: num(raw, "bid_price"),
    bidSize: num(raw, "bid_vol"),
    ask: num(raw, "ask_price"),
    askSize: num(raw, "ask_vol"),

    marketCap: num(raw, "total_market_val"),
    peTtm: num(raw, "pe_ttm_ratio"),
    pb: num(raw, "pb_ratio"),
    eps: num(raw, "earning_per_share"),
    dividendYield: num(raw, "dividend_ratio_ttm"),
    sharesOutstanding: num(raw, "outstanding_shares"),

    preMarket: extended(raw, "pre"),
    afterHours: extended(raw, "after"),
    overnight: extended(raw, "overnight"),

    option: isOption
      ? {
          type: optionType === "call" || optionType === "put" ? optionType : undefined,
          strike: num(raw, "option_strike_price"),
          daysToExpiry: num(raw, "option_expiry_date_distance"),
          style: text(raw, "option_area_type"),
          multiplier: num(raw, "option_contract_multiplier"),
          impliedVolatility: iv === undefined ? undefined : iv > 5 ? iv / 100 : iv,
          delta: num(raw, "delta"),
          gamma: num(raw, "gamma"),
          theta: num(raw, "theta"),
          vega: num(raw, "vega"),
          rho: num(raw, "rho"),
          openInterest: num(raw, "option_open_interest"),
          notional: num(raw, "option_contract_nominal_value"),
        }
      : undefined,
  };
}
