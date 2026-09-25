
/**
 * What the account is worth to the people looking at it.
 *
 * The family is split between China and Singapore, so "up $1,200" is not the
 * whole story: the same dollars can be worth less in yuan than they were last
 * month even when the account went up. This turns one account into four
 * honest answers.
 *
 * moomoo does not publish exchange rates — its API covers US equities and
 * options, and nothing else — so the rates come from the European Central
 * Bank's published daily reference rates, via Frankfurter, which is free,
 * needs no key and is the same series banks quote against. USD is included
 * as the identity so every view is built the same way.
 */
export const VIEW_CURRENCIES = ["USD", "CNY", "SGD", "EUR"] as const;
export type ViewCurrency = (typeof VIEW_CURRENCIES)[number];

export const CURRENCY_LABEL: Record<ViewCurrency, { en: string; zh: string }> = {
  USD: { en: "US dollars", zh: "美元" },
  CNY: { en: "Chinese yuan", zh: "人民币" },
  SGD: { en: "Singapore dollars", zh: "新加坡元" },
  EUR: { en: "Euros", zh: "欧元" },
};

export type RateSeries = Record<ViewCurrency, { date: string; value: number }[]>;

/**
 * The rate on a date, or the most recent one before it.
 *
 * Rates are published on business days and a portfolio snapshot can land on
 * one that has none — a holiday in Frankfurt is not a holiday in New York.
 * Carrying the last published rate forward is what every accounting system
 * does, and is far better than dropping the day.
 */
export function rateOn(
  series: { date: string; value: number }[],
  date: string,
): number | null {
  let found: number | null = null;
  for (const point of series) {
    if (point.date > date) break;
    found = point.value;
  }
  return found;
}

export type CurrencyView = {
  code: ViewCurrency;
  startRate: number;
  endRate: number;
  ratePercent: number;
  startValue: number;
  endValue: number;
  /** Deposits less withdrawals, each converted at the rate on its own day. */
  paidIn: number;
  /** End less start less what was paid in, all in this currency. */
  madeOrLost: number;
  /** Time-weighted, chained day by day in this currency. */
  returnPercent: number;
  /** The part of madeOrLost that the exchange rate's moves account for. */
  fromRate: number;
};

/**
 * The account measured in another currency, day by day.
 *
 * Every day's value is converted at that day's rate, and so is every
 * deposit: money sent in at 7.10 yuan to the dollar cost 7.10 yuan a dollar,
 * whatever the rate is later. Converting only the first and last day, as this
 * used to, treated a deposit made last week as if it had been exposed to the
 * whole period's rate move — a hundred dollars paid in at 7.5 was credited
 * with the move from 7.0.
 *
 * From the daily figures:
 * - the return is time-weighted, chained exactly as the dollar index is, so
 *   a deposit is never a gain in any currency;
 * - what was made or lost is the end less the start less what was paid in;
 * - the rate's share of that is what remains once each day's result in the
 *   account's own currency is converted at that day's rate. The two shares
 *   add up to the whole by construction.
 *
 * Rates are quoted per US dollar, so the account's own currency (`base`)
 * can be any of the four, not only dollars.
 */
export function currencyView(
  points: { date: string; value: number }[],
  flows: { date: string; amount: number }[],
  code: ViewCurrency,
  base: ViewCurrency,
  rates: RateSeries,
): CurrencyView | null {
  if (points.length < 2) return null;

  const perUsd = (currency: ViewCurrency, date: string) =>
    currency === "USD" ? 1 : rateOn(rates[currency] ?? [], date);
  const factor = (date: string): number | null => {
    const to = perUsd(code, date);
    const from = perUsd(base, date);
    return to && from ? to / from : null;
  };

  const first = points[0];
  const startRate = factor(first.date);
  if (!startRate) return null;

  // End-of-day convention, as in the dollar index: a transfer dated on a
  // day is inside that day's closing value.
  const later = flows
    .filter((flow) => flow.date > first.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  let index = 1;
  let paidIn = 0;
  let investing = 0;
  let previous = first;
  let previousRate = startRate;
  let next = 0;

  for (const point of points.slice(1)) {
    const rate = factor(point.date);
    if (!rate) return null;

    let flowInBase = 0;
    let flowHere = 0;
    while (next < later.length && later[next].date <= point.date) {
      const flowRate = factor(later[next].date);
      if (!flowRate) return null;
      flowInBase += later[next].amount;
      flowHere += later[next].amount * flowRate;
      next += 1;
    }

    const before = previous.value * previousRate;
    const now = point.value * rate;
    if (before > 0) index *= (now - flowHere) / before;
    paidIn += flowHere;
    investing += (point.value - previous.value - flowInBase) * rate;

    previous = point;
    previousRate = rate;
  }

  const startValue = first.value * startRate;
  const endValue = previous.value * previousRate;
  const madeOrLost = endValue - startValue - paidIn;

  return {
    code,
    startRate,
    endRate: previousRate,
    ratePercent: ((previousRate - startRate) / startRate) * 100,
    startValue,
    endValue,
    paidIn,
    madeOrLost,
    returnPercent: (index - 1) * 100,
    fromRate: madeOrLost - investing,
  };
}
