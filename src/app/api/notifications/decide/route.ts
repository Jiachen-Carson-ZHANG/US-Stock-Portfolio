import { recordActivity } from "@/lib/activity";
import { decideAccount } from "@/lib/accounts";
import { decideRequest } from "@/lib/access";
import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { findNotification, recordDecision } from "@/lib/notifications";
import { notificationDecisionSchema } from "@/lib/schemas";

/**
 * Answers a request from the bell.
 *
 * The bell is a shortcut, never a second set of rules. Both branches call the
 * same functions the settings page calls, and those are where "may this
 * person decide this" is checked — approving an account still needs to be an
 * administrator, and sharing a portfolio still needs to be its owner. All
 * this route adds is not having to go and find the request again.
 */
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

  const parsed = notificationDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const notification = await findNotification(db, user.id, parsed.data.notificationId);
  if (!notification || !notification.subjectId) {
    return Response.json({ error: "Nothing to answer" }, { status: 404 });
  }
  if (notification.decision) {
    return Response.json({ error: "That was already answered." }, { status: 409 });
  }

  const approve = parsed.data.approve;

  if (notification.kind === "account_request") {
    if (user.role !== "owner") {
      return Response.json({ error: "Only an owner can let somebody in." }, { status: 403 });
    }
    const result = await decideAccount(db, {
      userId: notification.subjectId,
      deciderId: user.id,
      approve,
    });
    if (!result.ok) {
      return Response.json({ error: result.reason ?? "Could not answer" }, { status: 409 });
    }
    await recordActivity(db, {
      userId: user.id,
      username: user.username,
      kind: approve ? "account_approve" : "account_decline",
      target: notification.subjectId,
    });
  } else if (notification.kind === "access_request") {
    const result = await decideRequest(db, {
      requestId: notification.subjectId,
      deciderId: user.id,
      approve,
      isAdministrator: user.role === "owner",
    });
    if (!result.ok) {
      return Response.json({ error: result.reason ?? "Could not answer" }, { status: 403 });
    }
  } else {
    return Response.json({ error: "That notification is not a question." }, { status: 400 });
  }

  await recordDecision(db, user.id, notification.id, approve ? "approved" : "declined");
  return Response.json({ ok: true, decision: approve ? "approved" : "declined" });
}
