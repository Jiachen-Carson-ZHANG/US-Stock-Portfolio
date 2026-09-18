import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tailwind class for a signed financial figure. Colour carries no judgement. */
export function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-foreground";
  return value > 0 ? "text-positive" : "text-negative";
}
