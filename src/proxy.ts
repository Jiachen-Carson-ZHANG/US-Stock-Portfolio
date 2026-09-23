import { isOpenAccess } from "@/lib/auth/mode";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  // Signing up necessarily happens before there is a session to check.
  "/register",
  "/api/auth/register",
  // Scheduled jobs and the keep-warm ping carry their own credentials, or
  // none because they reveal nothing.
  "/api/cron/snapshot",
  "/api/cron/reconstruct",
  "/api/cron/orders",
  "/api/health",
]);

/**
 * Reachable with a session whatever state the account is in. The page itself
 * decides what to say; the middleware only needs to not redirect it to
 * /login, which would look like the password was wrong.
 */
const SESSION_PATHS = new Set(["/pending", "/api/auth/logout"]);

/**
 * Defence in depth only. This checks for a cookie, not a valid session — every
 * page and API route independently authorizes server-side before returning any
 * portfolio data (§4), so a forged cookie gains nothing here.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isOpenAccess()) return NextResponse.next();
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (SESSION_PATHS.has(pathname)) return NextResponse.next();

  if (!request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
