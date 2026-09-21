import { getCurrentUser, requireApiOwner, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { decideRequest, pendingRequestsFor, requestAccess } from "@/lib/access";
import { canRead, findBySlug } from "@/lib/portfolios";
import { accessRequestSchema, accessDecisionSchema } from "@/lib/schemas";

/** The requests waiting on you, as the owner of the portfolios in question. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const db = await getDb();
  return Response.json({ requests: await pendingRequestsFor(db, user.id) });
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = accessRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const portfolio = await findBySlug(db, parsed.data.slug);
  if (!portfolio) return Response.json({ error: "No such portfolio" }, { status: 404 });

  // Asking for something you already have is a no-op, not an error worth
  // explaining — it happens on a stale tab after being approved.
  if (await canRead(db, user, portfolio.id)) {
    return Response.json({ ok: true, alreadyHasAccess: true });
  }

  const result = await requestAccess(db, {
    portfolioId: portfolio.id,
    userId: user.id,
    userName: user.displayName,
    message: parsed.data.message || undefined,
  });

  return Response.json({ ok: true, created: result.created });
}

export async function PATCH(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = accessDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await decideRequest(await getDb(), {
    requestId: parsed.data.requestId,
    deciderId: user.id,
    approve: parsed.data.approve,
    isAdministrator: user.role === "owner",
  });

  if (!result.ok) {
    return Response.json({ error: result.reason ?? "Could not answer" }, { status: 403 });
  }
  return Response.json({ ok: true });
}

/** Everything still waiting, for the administrator's overview. */
export async function HEAD() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;
  return new Response(null, { status: 204 });
}
