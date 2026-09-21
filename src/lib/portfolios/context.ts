import "server-only";
import { notFound, redirect } from "next/navigation";
import { forbidden, requireUser, unauthorized, getCurrentUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { canRead, defaultFor, findBySlug, type Portfolio } from "@/lib/portfolios";

export type PortfolioContext = { user: AuthUser; portfolio: Portfolio };

/**
 * Resolves which portfolio a request is about, and proves the caller may see
 * it, in one place.
 *
 * Every loader goes through this rather than trusting a slug from the URL.
 * The switcher only shows portfolios you can open, but a hidden link is not
 * access control — someone who guesses "/mirat" has to be stopped here.
 *
 * A portfolio you cannot read is reported as missing rather than forbidden.
 * Answering "403" to a guessed slug confirms the portfolio exists, which is
 * information the guesser did not have.
 */
async function resolve(
  user: AuthUser,
  slug: string | undefined,
): Promise<Portfolio | null> {
  const db = await getDb();

  if (!slug) return defaultFor(db, user);

  const portfolio = await findBySlug(db, slug);
  if (!portfolio) return null;
  return (await canRead(db, user, portfolio.id)) ? portfolio : null;
}

/** Server Component guard. Sends the signed-out to /login, the rest to 404. */
export async function requirePortfolio(slug?: string): Promise<PortfolioContext> {
  const user = await requireUser();
  const portfolio = await resolve(user, slug);

  // No slug and nothing visible means the account has no portfolio at all,
  // which is a state to explain rather than a 404 to stare at.
  if (!portfolio && !slug) redirect("/no-portfolio");
  if (!portfolio) notFound();

  return { user, portfolio };
}

/** Route Handler guard. Returns a Response instead of redirecting. */
export async function requirePortfolioApi(
  slug?: string,
): Promise<PortfolioContext | { response: Response }> {
  const user = await getCurrentUser();
  if (!user) return { response: unauthorized() };

  const portfolio = await resolve(user, slug);
  if (!portfolio) {
    return {
      response: Response.json({ error: "No such portfolio" }, { status: 404 }),
    };
  }

  return { user, portfolio };
}

/** Writing is narrower than reading: only the owner of the money may write. */
export function requireWritable(
  context: PortfolioContext,
): { response: Response } | null {
  return context.portfolio.ownerUserId === context.user.id ? null : { response: forbidden() };
}
