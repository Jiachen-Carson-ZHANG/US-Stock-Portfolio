import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { isOpenAccess } from "@/lib/auth/guards";
import { checkRateLimit, recordFailedAttempt } from "@/lib/auth/rate-limit";
import { RegistrationError, register } from "@/lib/accounts";
import { registerSchema } from "@/lib/schemas";

/**
 * Open signup, approval-gated.
 *
 * Counted against one shared bucket rather than per username, because the
 * abuse here is volume from one source rather than guessing at one account.
 * Five in fifteen minutes is generous for a family site and useless for
 * filling the pending queue.
 */
const REGISTER_BUCKET = "__register__";

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

  const limit = await checkRateLimit(db, REGISTER_BUCKET);
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
    await recordFailedAttempt(db, REGISTER_BUCKET);
    logger.info("auth.register.requested", { username: parsed.data.username });

    return Response.json({ ok: true, pending: true }, { status: 201 });
  } catch (error) {
    await recordFailedAttempt(db, REGISTER_BUCKET);
    if (error instanceof RegistrationError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    logger.error("auth.register.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Could not create the account." }, { status: 500 });
  }
}
