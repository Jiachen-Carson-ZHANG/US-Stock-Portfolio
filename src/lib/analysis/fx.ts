
/**
 * What the account is worth to the people looking at it.
 *
 * The family is spread across China, Singapore, Europe, Canada and
 * Australia, so "up $1,200" is not the whole story: the same dollars can be
 * worth less in yuan than they were last month even when the account went up.
 * This turns one account into an honest answer per currency.
 *
 * moomoo does not publish exchange rates — its API covers US equities and
 * options, and nothing else — so the rates come from the European Central
 * Bank's published daily reference rates, via Frankfurter, which is free,
 * needs no key and is the same series banks quote against. USD is included
 * as the identity so every view is built the same way.
 */
export const VIEW_CURRENCIES = ["USD", "CNY", "SGD", "EUR", "CAD", "AUD"] as const;
export type ViewCurrency = (typeof VIEW_CURRENCIES)[number];

export const CURRENCY_LABEL: Record<ViewCurrency, { en: string; zh: string }> = {
  USD: { en: "US dollars", zh: "美元" },
  CNY: { en: "Chinese yuan", zh: "人民币" },
  SGD: { en: "Singapore dollars", zh: "新加坡元" },
  EUR: { en: "Euros", zh: "欧元" },
  CAD: { en: "Canadian dollars", zh: "加拿大元" },
  AUD: { en: "Australian dollars", zh: "澳大利亚元" },
};

export type RateSeries = Record<ViewCurrency, { date: string; value: number }[]>;

/** No rates at all: what a page shows while rates cannot be had. */
export function emptyRates(): RateSeries {
  return Object.fromEntries(VIEW_CURRENCIES.map((code) => [code, []])) as unknown as RateSeries;
}

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

export type DepositRow = {
  date: string;
  /** In the account's own currency; a withdrawal is negative. */
  amount: number;
  rateThen: number;
  /** What the transfer came to in this currency on its own day. */
  then: number;
  /** The same money at the latest rate. */
  now: number;
  /** now − then: what the rate has done to that money since, and nothing else. */
  fromRate: number;
};

/**
 * Each transfer on its own, in another currency.
 *
 * The table above answers for the account as a whole; this answers "the
 * $5,000 I sent in March — what did it cost me in yuan, and what is it worth
 * in yuan now, before counting anything the investments did?". Each transfer
 * is converted at the rate on its own day and again at the latest rate, and
 * the difference is the rate move alone.
 *
 * A transfer dated before the first published rate in the series (a weekend
 * deposit on the first day the account existed) takes the first rate after it.
 */
export function depositsIn(
  flows: { date: string; amount: number }[],
  code: ViewCurrency,
  base: ViewCurrency,
  rates: RateSeries,
): { rateNow: number; asOf: string; rows: DepositRow[] } | null {
  if (code === base || flows.length === 0) return null;
  const perUsd = (currency: ViewCurrency, date: string) => {
    if (currency === "USD") return 1;
    const series = rates[currency] ?? [];
    return rateOn(series, date) ?? series[0]?.value ?? null;
  };
  const factor = (date: string) => {
    const to = perUsd(code, date);
    const from = perUsd(base, date);
    return to && from ? to / from : null;
  };

  const asOf = [...(rates[code] ?? [])].pop()?.date;
  const rateNow = asOf ? factor(asOf) : null;
  if (!asOf || !rateNow) return null;

  const rows: DepositRow[] = [];
  for (const flow of [...flows].sort((a, b) => a.date.localeCompare(b.date))) {
    const rateThen = factor(flow.date);
    if (!rateThen) return null;
    const then = flow.amount * rateThen;
    const now = flow.amount * rateNow;
    rows.push({ date: flow.date, amount: flow.amount, rateThen, then, now, fromRate: now - then });
  }
  return { rateNow, asOf, rows };
}
