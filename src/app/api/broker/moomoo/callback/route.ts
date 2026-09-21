import { getCurrentUser } from "@/lib/auth/guards";
import { recordActivity } from "@/lib/activity";
import { authenticateRequest } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
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
  if (!user || user.role !== "owner") {
    return Response.redirect(new URL("/dashboard", request.url), 303);
  }

  const query = new URL(request.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");

  const pending = await consumePendingFlow();

  if (!pending || !state || pending.state !== state) {
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

    const db = await getDb();
    await saveConnection(db, {
      refreshToken: tokens.refresh_token,
      scope: tokens.scope ?? "",
      accountId: null,
    });
    clearTokenCache();

    const connector = await authenticateRequest();
    if (connector) {
      await recordActivity(db, {
        userId: connector.id,
        username: connector.username,
        kind: "broker_connect",
        detail: `moomoo · ${tokens.scope ?? "no scope reported"}`,
      });
    }
    logger.info("broker.connect.success", {
      provider: "moomoo",
      scope: tokens.scope,
    });

    // Snapshots describe whatever portfolio was loaded when they were taken.
    // Synthetic history would misrepresent the real account, so it is dropped —
    // but only when nothing real has been recorded yet.
    if (!(await storedBrokers(db)).includes("moomoo")) {
      const dropped = await clearSnapshots(db);
      if (dropped > 0) {
        logger.info("portfolio.snapshots.cleared", { provider: "moomoo", dropped });
      }
    }

    // Pull holdings immediately so the dashboard is populated on return.
    try {
      const count = await syncPositions(db, new MoomooBrokerProvider(), "moomoo");
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
