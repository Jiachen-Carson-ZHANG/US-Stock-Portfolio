import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { checkRateLimit, recordFailedAttempt } from "@/lib/auth/rate-limit";
import { hintRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/**
 * The reminder somebody wrote for themselves at sign-up.
 *
 * Open without a session, necessarily — whoever is asking has forgotten how
 * to get one. So it is careful about what it gives away:
 *
 * An account with no hint and a name that does not exist get the same answer,
 * so the endpoint cannot be used to list who has an account. Only an account
 * that chose to leave a hint confirms its existence, which is the trade its
 * owner made by writing one.
 *
 * Every lookup counts against the caller's address, ten in fifteen minutes,
 * so a script cannot walk through usernames reading everybody's hints.
 */
const MAX_LOOKUPS = 10;

function bucketFor(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const source =
    forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `__hint__:${source}`;
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => ({}));
  const parsed = hintRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const db = await getDb();
  const bucket = bucketFor(request);
  const limit = await checkRateLimit(db, bucket, new Date(), MAX_LOOKUPS);
  if (limit.blocked) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  await recordFailedAttempt(db, bucket);

  const [row, owner] = await Promise.all([
    db.get<{ password_hint: string | null }>(
      `SELECT password_hint FROM users
        WHERE username = ? AND disabled_at IS NULL`,
      [parsed.data.username],
    ),
    // Who to ask, by name, so the advice is something a person can act on.
    db.get<{ display_name: string }>(
      `SELECT display_name FROM users
        WHERE role = 'owner' AND status = 'active' AND disabled_at IS NULL
        ORDER BY created_at LIMIT 1`,
    ),
  ]);

  return Response.json({
    hint: row?.password_hint ?? null,
    owner: owner?.display_name ?? null,
  });
}
