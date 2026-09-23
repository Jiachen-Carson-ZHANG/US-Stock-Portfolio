/**
 * What an option is worth before it expires.
 *
 * A payoff diagram drawn at expiry answers "what if I hold this to the end",
 * which is a real question but rarely the one being asked. A spread bought
 * for 15.90 and now marked at 19.48 has not expired; most of what it is
 * worth today is time value, and selling it tomorrow returns that too. A
 * chart that only shows the expiry line says the position is worth nothing
 * above break-even until December, which is simply wrong.
 *
 * Black-Scholes is used not because the market obeys it, but because it is
 * the language option prices are quoted in: every screen quotes an implied
 * volatility, which is the number that makes this formula reproduce the
 * traded price. So the volatility is read back out of the position's own
 * current price rather than assumed, and then used to re-price it at other
 * share prices. Where a price cannot be inverted — a contract quoted below
 * its own intrinsic value, most often because nobody has traded it today —
 * the curve is simply not drawn rather than drawn wrong.
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Abramowitz and Stegun 7.1.26, accurate to about 1e-7 — far past what a chart needs. */
export function cdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export type OptionType = "call" | "put";

/**
 * Value of one share's worth of option. `years` is time to expiry; at or past
 * zero this collapses to the intrinsic value, which is exactly right.
 */
export function blackScholes(
  type: OptionType,
  spot: number,
  strike: number,
  years: number,
  rate: number,
  vol: number,
): number {
  if (!(spot > 0) || !(strike > 0)) return 0;
  if (!(years > 0) || !(vol > 0)) {
    return type === "call"
      ? Math.max(0, spot - strike)
      : Math.max(0, strike - spot);
  }

  const sqrtT = Math.sqrt(years);
  const d1 =
    (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const discounted = strike * Math.exp(-rate * years);

  return type === "call"
    ? spot * cdf(d1) - discounted * cdf(d2)
    : discounted * cdf(-d2) - spot * cdf(-d1);
}

export function vega(
  spot: number,
  strike: number,
  years: number,
  rate: number,
  vol: number,
): number {
  if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(vol > 0)) return 0;
  const sqrtT = Math.sqrt(years);
  const d1 =
    (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * sqrtT);
  return spot * pdf(d1) * sqrtT;
}

/**
 * The volatility that makes the formula agree with the market's own price.
 *
 * Newton's method, with a bisection fallback, because Newton alone wanders
 * off when vega is tiny — which is exactly the case for a contract deep in or
 * far out of the money, and those are the ones a spread is made of.
 */
export function impliedVol(
  price: number,
  type: OptionType,
  spot: number,
  strike: number,
  years: number,
  rate: number,
): number | null {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(years > 0)) return null;

  const intrinsic =
    type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  // Below intrinsic value there is no volatility that fits: the quote is
  // stale or crossed, and pretending otherwise would draw a confident line
  // through a number that is not a price.
  if (price < intrinsic - 1e-6) return null;

  let low = 1e-4;
  let high = 5;

  // The value is monotone in volatility, so if the market price sits outside
  // the range the ends produce, no answer exists inside it either.
  if (blackScholes(type, spot, strike, years, rate, high) < price) return null;

  let vol = 0.3;
  for (let i = 0; i < 50; i += 1) {
    const value = blackScholes(type, spot, strike, years, rate, vol);
    const diff = value - price;
    if (Math.abs(diff) < 1e-6) return vol;

    if (diff > 0) high = vol;
    else low = vol;

    const slope = vega(spot, strike, years, rate, vol);
    const step = slope > 1e-8 ? vol - diff / slope : NaN;
    vol = Number.isFinite(step) && step > low && step < high ? step : (low + high) / 2;
  }

  return vol > 0 ? vol : null;
}

export type PricedLeg = {
  type: OptionType;
  strike: number;
  quantity: number;
  multiplier: number;
  /** Premium per share paid (positive) or received (the leg's quantity is negative). */
  premium: number;
  /** Implied volatility solved from this leg's own current price, if solvable. */
  vol: number | null;
};

export function yearsUntil(expiry: string, now: Date = new Date()): number {
  // Expiry is at the close on its date; the hour barely matters at this scale,
  // and pretending otherwise would imply a precision this does not have.
  const end = Date.parse(`${expiry}T21:00:00Z`);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, (end - now.getTime()) / (365.25 * 86_400_000));
}

/**
 * Profit or loss on the whole position if the shares were at `spot` today,
 * with the same time left as there is now.
 *
 * Holding time constant is the point: it separates "what if the share moves"
 * from "what if nothing happens for two months", which are different
 * questions and get confused constantly.
 */
export function valueToday(
  legs: PricedLeg[],
  spot: number,
  years: number,
  rate: number,
  fees = 0,
): number | null {
  if (legs.some((leg) => leg.vol === null)) return null;

  const total = legs.reduce((sum, leg) => {
    const value = blackScholes(leg.type, spot, leg.strike, years, rate, leg.vol!);
    return sum + (value - leg.premium) * leg.quantity * leg.multiplier;
  }, 0);

  return total - fees;
}
