import "server-only";
import { cookies } from "next/headers";
import type { DB } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { canRead, defaultFor, findBySlug, type Portfolio } from ".";

/**
 * The portfolio somebody is actually looking at.
 *
 * Half the pages carry a portfolio in their address and half do not — the
 * playground, the arena, the account page belong to a person rather than an
 * account. Going to one of those and coming back used to land you on a
 * "default" portfolio chosen by a rule, so somebody reading Carson's holdings
 * could visit the playground, click Holdings, and find themselves in their own
 * practice account instead. Nothing they did said to switch, so it read as the
 * site deciding for them.
 *
 * Remembering the last one they opened fixes it for everybody rather than
 * tuning which default happens to be right. Whoever you were reading is who
 * you are still reading.
 *
 * A remembered choice is never a grant. It is re-checked against the access
 * rule on every use, so a portfolio that stops being shared with you stops
 * being where you land — the cookie decides preference, never permission.
 */
const COOKIE = "viewing";

/** A year: this is a preference, and nobody wants it forgotten over a weekend. */
const MAX_AGE_SECONDS = 365 * 86_400;

/** The slug last remembered, if any, so a page can skip reporting it again. */
export async function rememberedSlug(): Promise<string | undefined> {
  try {
    return (await cookies()).get(COOKIE)?.value;
  } catch {
    return undefined;
  }
}

/**
 * Only works from a Route Handler or Server Action. Called while a page
 * renders, the cookie is refused and nothing is remembered, silently — which
 * is how it went unnoticed. /api/me/viewing is the caller.
 */
export async function rememberViewing(slug: string): Promise<void> {
  try {
    const jar = await cookies();
    if (jar.get(COOKIE)?.value === slug) return;
    jar.set(COOKIE, slug, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
  } catch {
    // Cookies cannot be set while rendering some routes. Remembering is a
    // convenience; failing to remember must never fail the page.
  }
}

/**
 * Where an address with no portfolio in it should go.
 *
 * The last one opened, if it is still readable; otherwise the ordinary
 * default.
 */
export async function lastViewedOr(
  db: DB,
  user: AuthUser,
): Promise<Portfolio | null> {
  try {
    const slug = (await cookies()).get(COOKIE)?.value;
    if (slug) {
      const portfolio = await findBySlug(db, slug);
      if (portfolio && (await canRead(db, user, portfolio.id))) return portfolio;
    }
  } catch {
    // No cookie jar available; fall through to the default.
  }

  return defaultFor(db, user);
}
