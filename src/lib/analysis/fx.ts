
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
