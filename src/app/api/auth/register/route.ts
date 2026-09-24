import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { isOpenAccess } from "@/lib/auth/guards";
import {
  MAX_REGISTRATIONS,
  checkRateLimit,
  recordFailedAttempt,
} from "@/lib/auth/rate-limit";
import { RegistrationError, register } from "@/lib/accounts";
import { registerSchema } from "@/lib/schemas";

/**
 * Open signup, approval-gated, counted per source.
 *
 * The abuse here is volume from one place rather than guessing at one
 * account: somebody filling the pending queue with ten sign-ups, each of
 * which rings a bell and, once approved, gets an account of its own.
 *
 * It used to be one shared bucket for everybody, which stopped that — and
 * also stopped the fourth real person signing up in an evening. Counting per
 * source instead keeps the limit tight on one person and invisible to a room
 * full of them. Five in fifteen minutes is generous for one human and useless
 * for filling a queue.
 *
 * The address is the best identifier available and it is not a strong one:
 * a phone changing network gets a new one, and a household shares one. Which
 * is the right trade — this only delays a sign-up, and approval is still the
 * thing that decides.
 */
function bucketFor(request: Request): string {
  // Behind a proxy the first entry is the client; the rest are the hops.
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const source =
    forwarded.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return `__register__:${source}`;
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  if (isOpenAccess()) {
    return Response.json(
      { error: "This deployment runs without sign-in." },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid details" },
      { status: 400 },
    );
  }

  const db = await getDb();

  const bucket = bucketFor(request);
  const limit = await checkRateLimit(db, bucket, new Date(), MAX_REGISTRATIONS);
  if (limit.blocked) {
    logger.warn("auth.register.rate_limited");
    return Response.json(
      { error: "Too many sign-ups just now. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    await register(db, parsed.data);
    // Counted whether or not it succeeded: the cost being limited is the
    // attempt, not the outcome.
    await recordFailedAttempt(db, bucket);
    logger.info("auth.register.requested", { username: parsed.data.username });

    return Response.json({ ok: true, pending: true }, { status: 201 });
  } catch (error) {
    await recordFailedAttempt(db, bucket);
    if (error instanceof RegistrationError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    logger.error("auth.register.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Could not create the account." }, { status: 500 });
  }
}
