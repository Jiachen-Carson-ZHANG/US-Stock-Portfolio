import { getCurrentUser } from "@/lib/auth/guards";
import { googleConfigured, startGoogle } from "@/lib/auth/google";

/**
 * Off to Google. `intent=link` attaches a Google account to the one signed
 * in; anything else signs in with it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const intent = url.searchParams.get("intent") === "link" ? "link" : "signin";
  if (!googleConfigured()) {
    return Response.redirect(new URL(intent === "link" ? "/account?google=unavailable" : "/login?google=unavailable", request.url), 303);
  }
  if (intent === "link" && !(await getCurrentUser())) {
    return Response.redirect(new URL("/login", request.url), 303);
  }
  return Response.redirect(await startGoogle(intent), 303);
}
