import { getSessionUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { recordFailure } from "@/lib/observe";

export const dynamic = "force-dynamic";

/**
 * Errors that happened in somebody's browser.
 *
 * The server log was complete and still blind: a page that froze on a phone
 * never failed on the server, so nothing was ever written. The failure lived
 * entirely in the browser, which reported it to nobody. Every error screen and
 * every uncaught browser error now posts here.
 *
 * Deliberately open without a session, because a broken session is one of the
 * things worth hearing about, and deliberately narrow in what it accepts: a
 * message, a path, the browser, and which build the page was running. No
 * query strings, no form contents, nothing typed.
 *
 * The build is the important part. A tab running code from an older deployment
 * is the most common cause of a frozen page, and comparing the build it
 * reports with the build that answered turns a guess into a fact.
 */
const MAX_PER_MINUTE = 60;

function clip(value: unknown, length: number): string {
  return typeof value === "string" ? value.slice(0, length) : "";
}

export async function POST(request: Request) {
  // Small by construction; anything bigger is not an error report.
  const text = await request.text().catch(() => "");
  if (text.length > 4_000) return new Response(null, { status: 413 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }

  const db = await getDb();

  // A browser stuck in a loop, or somebody pointing a script at this, must not
  // be able to bury every other entry in the log.
  const recent = await db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM request_timings
      WHERE path LIKE 'client %' AND created_at > ?`,
    [new Date(Date.now() - 60_000).toISOString()],
  );
  if ((recent?.n ?? 0) >= MAX_PER_MINUTE) return new Response(null, { status: 204 });

  const user = await getSessionUser().catch(() => null);

  const path = clip(body.path, 200).split("?")[0] || "unknown";
  const pageBuild = clip(body.build, 80) || "unknown";
  const serverBuild =
    process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  const stale = pageBuild !== "unknown" && pageBuild !== serverBuild;

  const detail = [
    clip(body.kind, 30) || "error",
    stale ? `STALE TAB (page ${pageBuild.slice(-8)} ≠ server ${serverBuild.slice(-8)})` : null,
    user ? `@${user.username}` : "signed out",
    clip(body.message, 300),
    clip(body.digest, 40) ? `ref ${clip(body.digest, 40)}` : null,
    clip(body.agent, 120),
  ]
    .filter(Boolean)
    .join(" · ");

  await recordFailure(`client ${path}`, detail);
  return new Response(null, { status: 204 });
}
