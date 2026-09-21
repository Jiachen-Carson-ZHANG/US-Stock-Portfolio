"use client";

import { usePathname } from "next/navigation";

/**
 * Pages that are not under a portfolio. Anything else at the first path
 * segment is a portfolio slug.
 *
 * Kept as a deny-list rather than passing the slug down through every
 * component: these pages are few and change rarely, whereas the components
 * that need a link are many.
 */
const UNSCOPED = new Set([
  "watchlist",
  "family",
  "account",
  "settings",
  "login",
  "no-portfolio",
  "api",
]);

/**
 * The prefix a link should carry to stay inside the portfolio being viewed.
 *
 * Without it, clicking a holding while looking at someone else's portfolio
 * would quietly move you back to your own.
 */
export function usePortfolioBase(): string {
  const first = (usePathname() ?? "").split("/")[1] ?? "";
  return first && !UNSCOPED.has(first) ? `/${first}` : "";
}
