import { cdf } from "@/lib/analysis/options-pricing";

/**
 * Finding an option to trade, by what somebody wants to happen.
 *
 * People do not arrive wanting "the 215 put expiring on the 18th"; they
 * arrive wanting income from a share they would not mind owning, or a bet on
 * a rise that cannot lose more than they put in. Each strategy here turns one
 * expiry's chain into ranked candidates, with the same handful of figures for
 * every one of them — what you get or pay, the most you can make, the most
 * you can lose, where it breaks even, and how likely that is — so they can
 * be compared without knowing the jargon.
 *
 * Prices are the ones you would actually trade at: a sale at the bid, a
 * purchase at the ask. The last traded price flatters every strategy, and on
 * a thin contract it can be hours old.
 */

export type StrategyKey =
  | "sell-put"
  | "covered-call"
  | "buy-call"
  | "buy-put"
  | "bull-call-spread"
  | "bear-put-spread"
  | "bull-put-spread"
  | "bear-call-spread";

export const STRATEGIES: StrategyKey[] = [
  "sell-put",
  "covered-call",
  "buy-call",
  "buy-put",
  "bull-call-spread",
  "bear-put-spread",
  "bull-put-spread",
  "bear-call-spread",
];

export type ChainQuote = {
  symbol: string;
  type: "call" | "put";
  strike: number;
  bid?: number;
  ask?: number;
  /** Implied volatility as a fraction: 0.45 is 45%. */
  iv?: number;
  delta?: number;
  openInterest?: number;
  volume?: number;
  multiplier: number;
};

export type Leg = {
  symbol: string;
  side: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  /** Per share, at the price that side would actually trade at. */
  price: number;
};

export type Candidate = {
  legs: Leg[];
  /** Per share, net: positive is money received, negative money paid. */
  net: number;
  /** For one set of contracts, in money. Null when there is no ceiling. */
  maxProfit: number | null;
  /** For one set, in money, as a positive number. Null when there is no floor. */
  maxLoss: number | null;
  breakEven: number;
  /** Chance of any profit at expiry, from the market's own implied volatility. */
  chance: number | null;
  /** Money tied up for one set: the cost, the margin, or the cash set aside. */
  capital: number;
  /** maxProfit over capital, per year — the figure that makes expiries comparable. */
  annualReturn: number | null;
  multiplier: number;
};

const RATE = 0.04;

/**
 * Probability the share finishes above `level` at expiry.
 *
 * The same lognormal the prices are quoted in, with the contract's own
 * implied volatility — so this is the chance the market is pricing, not a
 * forecast. That is said wherever it is shown.
 */
export function chanceAbove(spot: number, level: number, years: number, vol: number): number {
  if (!(spot > 0) || !(level > 0) || !(years > 0) || !(vol > 0)) {
    return spot > level ? 1 : 0;
  }
  const d2 = (Math.log(spot / level) + (RATE - 0.5 * vol * vol) * years) / (vol * Math.sqrt(years));
  return cdf(d2);
}

function priced(quote: ChainQuote, side: "buy" | "sell"): number | null {
  const price = side === "buy" ? quote.ask : quote.bid;
  return price !== undefined && price > 0 ? price : null;
}

function leg(quote: ChainQuote, side: "buy" | "sell"): Leg | null {
  const price = priced(quote, side);
  return price === null
    ? null
    : { symbol: quote.symbol, side, type: quote.type, strike: quote.strike, price };
}

function annual(profit: number | null, capital: number, years: number): number | null {
  if (profit === null || !(capital > 0) || !(years > 0)) return null;
  return profit / capital / years;
}

/**
 * Candidates for one strategy on one expiry, best first.
 *
 * "Best" differs by strategy and is stated in `rankingFor`: income trades by
 * return per year among those more likely than not to pay; spreads by what
 * they can make against what they can lose; single bought options by how
 * little the share has to move.
 */
export function candidates(
  strategy: StrategyKey,
  chain: ChainQuote[],
  spot: number,
  years: number,
  limit = 8,
  /**
   * For trades that collect money up front: how likely, at least, keeping it
   * has to be. The person's own choice — more certain means less income —
   * and the list is ranked by income within it.
   */
  minChance = 0.7,
): Candidate[] {
  const calls = chain.filter((q) => q.type === "call").sort((a, b) => a.strike - b.strike);
  const puts = chain.filter((q) => q.type === "put").sort((a, b) => a.strike - b.strike);
  const out: Candidate[] = [];

  const single = (quote: ChainQuote, side: "buy" | "sell") => {
    const l = leg(quote, side);
    if (!l) return;
    const m = quote.multiplier;
    const vol = quote.iv ?? 0;

    if (strategy === "sell-put") {
      const breakEven = quote.strike - l.price;
      const capital = quote.strike * m;
      const maxProfit = l.price * m;
      out.push({
        legs: [l], net: l.price, maxProfit, maxLoss: breakEven * m, breakEven,
        chance: vol > 0 ? chanceAbove(spot, breakEven, years, vol) : null,
        capital, annualReturn: annual(maxProfit, capital, years), multiplier: m,
      });
    } else if (strategy === "covered-call") {
      // Owning a hundred shares and selling one call against them.
      const breakEven = spot - l.price;
      const capital = spot * m;
      const maxProfit = (quote.strike - spot + l.price) * m;
      out.push({
        legs: [l], net: l.price, maxProfit, maxLoss: breakEven * m, breakEven,
        chance: vol > 0 ? chanceAbove(spot, breakEven, years, vol) : null,
        capital, annualReturn: annual(maxProfit, capital, years), multiplier: m,
      });
    } else if (strategy === "buy-call") {
      const breakEven = quote.strike + l.price;
      out.push({
        legs: [l], net: -l.price, maxProfit: null, maxLoss: l.price * m, breakEven,
        chance: vol > 0 ? chanceAbove(spot, breakEven, years, vol) : null,
        capital: l.price * m, annualReturn: null, multiplier: m,
      });
    } else if (strategy === "buy-put") {
      const breakEven = quote.strike - l.price;
      const maxProfit = breakEven * m;
      out.push({
        legs: [l], net: -l.price, maxProfit, maxLoss: l.price * m, breakEven,
        chance: vol > 0 ? 1 - chanceAbove(spot, breakEven, years, vol) : null,
        capital: l.price * m, annualReturn: null, multiplier: m,
      });
    }
  };

  const vertical = (
    list: ChainQuote[],
    bought: (low: ChainQuote, high: ChainQuote) => ChainQuote,
    bullish: boolean,
  ) => {
    // Neighbouring strikes, up to three steps apart: wider than that and it
    // is no longer the spread anybody asked for.
    for (let i = 0; i < list.length; i += 1) {
      for (let step = 1; step <= 3 && i + step < list.length; step += 1) {
        const low = list[i];
        const high = list[i + step];
        const long = bought(low, high);
        const short = long === low ? high : low;
        const buyLeg = leg(long, "buy");
        const sellLeg = leg(short, "sell");
        if (!buyLeg || !sellLeg) continue;

        const m = Math.min(long.multiplier, short.multiplier);
        const width = high.strike - low.strike;
        const net = sellLeg.price - buyLeg.price;
        const credit = net > 0;
        const maxProfit = (credit ? net : width + net) * m;
        const maxLoss = (credit ? width - net : -net) * m;
        if (!(maxProfit > 0) || !(maxLoss > 0)) continue;

        // Where it breaks even follows from which strike carries the cost.
        const breakEven =
          low.type === "call"
            ? low.strike + (credit ? net : -net)
            : high.strike - (credit ? net : -net);
        const vol = short.iv ?? long.iv ?? 0;
        const above = vol > 0 ? chanceAbove(spot, breakEven, years, vol) : null;
        out.push({
          legs: [buyLeg, sellLeg],
          net,
          maxProfit,
          maxLoss,
          breakEven,
          chance: above === null ? null : bullish ? above : 1 - above,
          capital: maxLoss,
          // Per year only where money is collected up front and held against
          // a known risk. On a bought spread it produced figures in the
          // thousands of percent, true and useless.
          annualReturn: credit ? annual(maxProfit, maxLoss, years) : null,
          multiplier: m,
        });
      }
    }
  };

  switch (strategy) {
    case "sell-put":
      puts.filter((q) => q.strike < spot).forEach((q) => single(q, "sell"));
      break;
    case "covered-call":
      calls.filter((q) => q.strike > spot).forEach((q) => single(q, "sell"));
      break;
    case "buy-call":
      calls.forEach((q) => single(q, "buy"));
      break;
    case "buy-put":
      puts.forEach((q) => single(q, "buy"));
      break;
    case "bull-call-spread":
      vertical(calls, (low) => low, true);
      break;
    case "bear-put-spread":
      vertical(puts, (_, high) => high, false);
      break;
    case "bull-put-spread":
      vertical(puts.filter((q) => q.strike < spot), (low) => low, true);
      break;
    case "bear-call-spread":
      vertical(calls.filter((q) => q.strike > spot), (_, high) => high, false);
      break;
  }

  return rank(strategy, out, spot, minChance).slice(0, limit);
}

/** How the list is ordered, in words, for the screen to say. */
export function rankingFor(strategy: StrategyKey): "income" | "reward" | "move" {
  if (strategy === "sell-put" || strategy === "covered-call") return "income";
  if (strategy === "buy-call" || strategy === "buy-put") return "move";
  return "reward";
}

function rank(
  strategy: StrategyKey,
  list: Candidate[],
  spot: number,
  minChance: number,
): Candidate[] {
  const kind = rankingFor(strategy);
  if (kind === "income" || strategy === "bull-put-spread" || strategy === "bear-call-spread") {
    // At least as likely to keep the money as asked for; then the most money
    // per year for the cash it ties up.
    return list
      .filter((c) => c.chance === null || c.chance >= minChance)
      .sort((a, b) => (b.annualReturn ?? 0) - (a.annualReturn ?? 0));
  }

  // Everything else: nearest the share price first. A deep in-the-money call
  // breaks even soonest and is really just an expensive way to hold the
  // share; at the money is where people start looking, so that is where the
  // list starts. Among spreads on the same bought strike, the most it can
  // make for what it risks.
  const bought = (c: Candidate) => c.legs.find((l) => l.side === "buy") ?? c.legs[0];
  return list.sort(
    (a, b) =>
      Math.abs(bought(a).strike - spot) - Math.abs(bought(b).strike - spot) ||
      (b.maxProfit ?? Infinity) / (b.maxLoss ?? 1) - (a.maxProfit ?? Infinity) / (a.maxLoss ?? 1),
  );
}
