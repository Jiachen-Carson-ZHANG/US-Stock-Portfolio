import { createHash, timingSafeEqual } from "node:crypto";
import { loadPortfolio } from "@/lib/portfolio/service";
import { getDb } from "@/lib/db";
import { hasSnapshot } from "@/lib/portfolio/snapshots";
import { isAfterMarketClose, marketDateString } from "@/lib/market-hours";
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
  const date = marketDateString(now);
  const db = await getDb();
  if (await hasSnapshot(db, date))
    return Response.json({ captured: false, reason: "Already recorded", date });
  try {
    await loadPortfolio(now);
    const captured = await hasSnapshot(db, date);
    return Response.json(
      {
        captured,
        date,
        ...(!captured
          ? { reason: "No fresh portfolio data; retry later" }
          : {}),
      },
      { status: captured ? 200 : 503 },
    );
  } catch {
    return Response.json(
      { error: "Snapshot capture failed; retry later" },
      { status: 503 },
    );
  }
}
