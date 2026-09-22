import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, validateSession, type AuthUser } from "./session";

import { isOpenAccess } from "./mode";
export { isOpenAccess } from "./mode";

const OPEN_ACCESS_USER: AuthUser = {
  id: "open-access",
  username: "family",
  displayName: "Family",
  role: "owner",
};

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isOpenAccess()) return OPEN_ACCESS_USER;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  // No cookie is already the answer, so do not open a connection to reach it.
  // It also keeps /login renderable while the database is unreachable, which is
  // when someone most needs to see a page rather than a server error.
  if (!token) return null;
  return validateSession(await getDb(), token);
}

/** Server Component guard. Redirects unauthenticated visitors to /login. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Server Component guard for owner-only pages.
 *
 * Viewers land on "/", which resolves to whichever portfolio is theirs —
 * "/dashboard" is no longer a page, only a redirect to the same place.
 */
export async function requireOwner(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/");
  return user;
}

export function unauthorized(): Response {
  return Response.json({ error: "Authentication required" }, { status: 401 });
}

export function forbidden(): Response {
  return Response.json({ error: "Not permitted" }, { status: 403 });
}

/** Route Handler guard. Returns null when the caller has no valid session. */
export async function authenticateRequest(): Promise<AuthUser | null> {
  return getCurrentUser();
}

export async function requireApiOwner(): Promise<
  { user: AuthUser } | { response: Response }
> {
  const user = await getCurrentUser();
  if (!user) return { response: unauthorized() };
  if (user.role !== "owner") return { response: forbidden() };
  return { user };
}
