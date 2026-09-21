import { recordActivity } from "@/lib/activity";
import { getCurrentUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { canRead, findById } from "@/lib/portfolios";
import { logger } from "@/lib/logger";
import { exchangeCode, writeScopesIn } from "@/lib/moomoo/oauth";
import { consumePendingFlow, redirectUri } from "@/lib/moomoo/flow";
import { saveConnection } from "@/lib/moomoo/tokens";
import { clearTokenCache } from "@/lib/moomoo/client";
import { storedBrokers, syncPositions } from "@/lib/portfolio/sync";
import { clearSnapshots } from "@/lib/portfolio/snapshots";
import { MoomooBrokerProvider } from "@/providers/broker/moomoo";

function back(request: Request, outcome: string): Response {
  const url = new URL("/settings", request.url);
  url.searchParams.set("moomoo", outcome);
  return Response.redirect(url, 303);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.redirect(new URL("/login", request.url), 303);
  }

  const query = new URL(request.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");

  const pending = await consumePendingFlow();

  const db = await getDb();

  // The portfolio is taken from the flow we started, never from the query, and
  // is re-checked here: a cookie survives a sign-out and could otherwise
  // attach a token to an account this person no longer has any claim on.
  const target = pending ? await findById(db, pending.portfolioId) : null;
  if (
    !pending ||
    !target ||
    target.ownerUserId !== user.id ||
    !(await canRead(db, user, target.id))
  ) {
    logger.warn("broker.connect.state_mismatch", { provider: "moomoo" });
    return back(request, "state_mismatch");
  }

  if (!state || pending.state !== state) {
    logger.warn("broker.connect.state_mismatch", { provider: "moomoo" });
    return back(request, "state_mismatch");
  }

  if (!code) return back(request, "denied");

  try {
    const tokens = await exchangeCode({
      code,
      clientId: process.env.MOOMOO_CLIENT_ID as string,
      redirectUri: redirectUri(),
      verifier: pending.verifier,
    });

    // The user chooses scopes on moomoo's consent screen, so a write grant is
    // refused here rather than stored — this app must never hold one (§10).
    const writeScopes = writeScopesIn(tokens.scope ?? "");
    if (writeScopes.length > 0) {
      logger.warn("broker.connect.rejected_write_scope", {
        provider: "moomoo",
        scopes: writeScopes.join(" "),
      });
      return back(request, "write_scope");
    }

    if (!tokens.refresh_token) {
      logger.error("broker.connect.no_refresh_token", { provider: "moomoo" });
      return back(request, "failed");
    }

    await saveConnection(db, target.id, {
      refreshToken: tokens.refresh_token,
      scope: tokens.scope ?? "",
      accountId: null,
    });
    clearTokenCache(target.id);

    await recordActivity(db, {
      userId: user.id,
      username: user.username,
      kind: "broker_connect",
      target: target.slug,
      detail: `moomoo · ${tokens.scope ?? "no scope reported"}`,
    });
    logger.info("broker.connect.success", {
      provider: "moomoo",
      scope: tokens.scope,
    });

    // Snapshots describe whatever portfolio was loaded when they were taken.
    // Synthetic history would misrepresent the real account, so it is dropped —
    // but only when nothing real has been recorded yet.
    if (!(await storedBrokers(db, target.id)).includes("moomoo")) {
      const dropped = await clearSnapshots(db, target.id);
      if (dropped > 0) {
        logger.info("portfolio.snapshots.cleared", { provider: "moomoo", dropped });
      }
    }

    // Pull holdings immediately so the dashboard is populated on return.
    try {
      const count = await syncPositions(
        db,
        target.id,
        new MoomooBrokerProvider(target.id),
        "moomoo",
      );
      logger.info("broker.sync.success", { provider: "moomoo", positions: count });
    } catch (error) {
      logger.error("broker.sync.failure", {
        provider: "moomoo",
        reason: error instanceof Error ? error.message : "unknown",
      });
      return back(request, "connected_sync_failed");
    }

    return back(request, "connected");
  } catch (error) {
    logger.error("broker.connect.failure", {
      provider: "moomoo",
      reason: error instanceof Error ? error.message : "unknown",
    });
    return back(request, "failed");
  }
}
