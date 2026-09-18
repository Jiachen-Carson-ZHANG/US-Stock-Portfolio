import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, validateSession, type AuthUser } from "./session";

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  return validateSession(getDb(), cookieStore.get(SESSION_COOKIE)?.value);
}

/** Server Component guard. Redirects unauthenticated visitors to /login. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Server Component guard for owner-only pages. Viewers land back on /dashboard. */
export async function requireOwner(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== "owner") redirect("/dashboard");
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
