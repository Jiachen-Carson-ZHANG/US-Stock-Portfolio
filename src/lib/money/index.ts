import Decimal from "decimal.js";
import type { Money, MoneyDTO } from "@/types/portfolio";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export function money(amount: Decimal.Value, currency: string): Money {
  return { amount: new Decimal(amount), currency };
}

export function zero(currency: string): Money {
  return { amount: new Decimal(0), currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount.plus(b.amount), currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount.minus(b.amount), currency: a.currency };
}

export function multiply(a: Money, factor: Decimal.Value): Money {
  return { amount: a.amount.times(factor), currency: a.currency };
}

export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, item) => add(acc, item), zero(currency));
}

export function isZero(a: Money): boolean {
  return a.amount.isZero();
}

/**
 * Percentage change of `part` against `base`. Returns null when base is zero,
 * so callers render an explicit blank rather than Infinity or NaN.
 */
export function percentOf(part: Money, base: Money): number | null {
  assertSameCurrency(part, base);
  if (base.amount.isZero()) return null;
  return part.amount.dividedBy(base.amount).times(100).toNumber();
}

export function toDTO(a: Money): MoneyDTO {
  return { amount: a.amount.toFixed(), currency: a.currency };
}

export function fromDTO(dto: MoneyDTO): Money {
  return { amount: new Decimal(dto.amount), currency: dto.currency };
}

export function formatMoney(
  dto: MoneyDTO,
  options: { signed?: boolean; maximumFractionDigits?: number } = {},
): string {
  const value = Number(dto.amount);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: dto.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(Math.abs(value));

  if (!options.signed) return value < 0 ? `-${formatted}` : formatted;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function formatPercent(
  value: number | null,
  options: { signed?: boolean } = {},
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const formatted = `${Math.abs(value).toFixed(2)}%`;
  if (!options.signed) return value < 0 ? `-${formatted}` : formatted;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
