import "server-only";
import { notFound, redirect } from "next/navigation";
import { forbidden, requireUser, unauthorized, getCurrentUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { canRead, findBySlug, type Portfolio } from "@/lib/portfolios";
import { lastViewedOr, rememberViewing } from "./last-viewed";

export type PortfolioContext = { user: AuthUser; portfolio: Portfolio };

/**
 * Resolves which portfolio a request is about, and proves the caller may see
 * it, in one place.
 *
 * Every loader goes through this rather than trusting a slug from the URL.
 * The switcher only shows portfolios you can open, but a hidden link is not
 * access control — someone who guesses "/mirat" has to be stopped here.
 *
 * A portfolio that exists but is not yours reports itself as such, so the
 * page can offer to ask for it. That does disclose that the address is
 * taken, which is a deliberate trade: among five family members, being able
 * to ask is worth more than hiding that a sister has an account.
 */
type Resolution =
  | { kind: "ok"; portfolio: Portfolio }
  | { kind: "missing" }
  | { kind: "locked"; portfolio: Portfolio };

async function resolve(user: AuthUser, slug: string | undefined): Promise<Resolution> {
  const db = await getDb();

  if (!slug) {
    // No portfolio named: whoever they were last reading, if they still may.
    const own = await lastViewedOr(db, user);
    return own ? { kind: "ok", portfolio: own } : { kind: "missing" };
  }

  const portfolio = await findBySlug(db, slug);
  if (!portfolio) return { kind: "missing" };
  if (!(await canRead(db, user, portfolio.id))) return { kind: "locked", portfolio };

  // Naming a portfolio in the address is the act of choosing one, so that is
  // what gets remembered — not a click on a switcher, which would miss every
  // other way of arriving.
  await rememberViewing(portfolio.slug);
  return { kind: "ok", portfolio };
}

/**
 * Server Component guard.
 *
 * Signed-out goes to /login. No portfolio at all goes to an explanation
 * rather than a 404 to stare at. A portfolio that exists but is not yours
 * goes to a page offering to ask for it.
 */
export async function requirePortfolio(slug?: string): Promise<PortfolioContext> {
  const user = await requireUser();
  const resolution = await resolve(user, slug);

  if (resolution.kind === "ok") return { user, portfolio: resolution.portfolio };
  if (resolution.kind === "locked") redirect(`/request-access/${resolution.portfolio.slug}`);
  if (!slug) redirect("/no-portfolio");
  notFound();
}

/** Route Handler guard. Returns a Response instead of redirecting. */
export async function requirePortfolioApi(
  slug?: string,
): Promise<PortfolioContext | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: unauthorized() };

  const resolution = await resolve(user, slug);
  if (resolution.kind === "locked") {
    return {
      response: Response.json(
        { error: "You do not have access to this portfolio", canRequest: true },
        { status: 403 },
      ),
    };
  }
  if (resolution.kind === "missing") {
    return {
      response: Response.json({ error: "No such portfolio" }, { status: 404 }),
    };
  }

  return { user, portfolio: resolution.portfolio };
}

/** Writing is narrower than reading: only the owner of the money may write. */
export function requireWritable(
  context: PortfolioContext,
): { response: Response } | null {
  return context.portfolio.ownerUserId === context.user.id ? null : { response: forbidden() };
}
