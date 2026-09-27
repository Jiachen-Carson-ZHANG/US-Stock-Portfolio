import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { awardCompletedPeriods } from "@/lib/arena/trophies";
import { isAfterMarketClose } from "@/lib/market-hours";
import { captureDailySnapshots } from "@/lib/portfolio/daily-capture";
export async function POST(request: Request) {
  const secret = process.env.SNAPSHOT_CRON_SECRET;
  if (!secret)
    return Response.json(
      { error: "Scheduler is not configured" },
      { status: 503 },
    );
  const digest = (v: string) => createHash("sha256").update(v).digest();
  if (
    !timingSafeEqual(
      digest(request.headers.get("authorization") ?? ""),
      digest(`Bearer ${secret}`),
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  if (!isAfterMarketClose(now))
    return Response.json({ captured: false, reason: "Outside capture window" });
  const db = await getDb();
  // The same routine the minute scheduler runs after the close; this route
  // stays for anybody who does schedule it separately.
  const { date, results } = await captureDailySnapshots(now);

  // After the day is recorded, not before: a period that ended yesterday is
  // only fully measurable once yesterday's close is in.
  const { awarded } = await awardCompletedPeriods(db, now);

  const captured = results.filter((r) => r.captured).length;
  return Response.json(
    { date, captured, awarded, results },
    // A partial failure is still a failure worth retrying, but only when
    // nothing at all was recorded and something was expected to be.
    { status: captured > 0 || results.length === 0 ? 200 : 503 },
  );
}
