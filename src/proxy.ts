import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

/**
 * Defence in depth only. This checks for a cookie, not a valid session — every
 * page and API route independently authorizes server-side before returning any
 * portfolio data (§4), so a forged cookie gains nothing here.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

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
