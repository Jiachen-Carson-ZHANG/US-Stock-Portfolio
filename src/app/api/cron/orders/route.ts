import { createHash, timingSafeEqual } from "node:crypto";
import { marketSession } from "@/lib/market-hours";
import { matchAllRestingOrders } from "@/lib/portfolio/service";

export const dynamic = "force-dynamic";

/**
 * Checks every resting order against the market, with nobody signed in.
 *
 * Meant to be called about once a minute by a scheduler. Vercel's own cron
 * runs daily on the free plan, which is no use here, so any external pinger
 * that can send a header works — see the README.
 *
 * GET rather than POST because that is all a simple uptime pinger sends, and
 * this changes nothing that the market has not already decided.
 */
export async function GET(request: Request) {
  const secret = process.env.SNAPSHOT_CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Scheduler is not configured" }, { status: 503 });
  }

  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    !timingSafeEqual(
      digest(request.headers.get("authorization") ?? ""),
      digest(`Bearer ${secret}`),
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // With the market shut the price cannot reach anything, so there is nothing
  // to match and the quote requests would be wasted. Pre-market and after
  // hours do count: they trade, thinly, and an order resting through them
  // should fill on what actually printed.
  if (marketSession(now) === "closed") {
    return Response.json({ matched: false, reason: "Market closed" });
  }

  const { accounts, orders } = await matchAllRestingOrders(now);
  return Response.json({ matched: true, accounts, orders });
}
