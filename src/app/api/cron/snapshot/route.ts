import { createHash, timingSafeEqual } from "node:crypto";
import { loadPortfolio } from "@/lib/portfolio/service";
import { getDb } from "@/lib/db";
import { listPortfolios } from "@/lib/portfolios";
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

  // Every portfolio, not "the" portfolio. One failing must not stop the rest,
  // so each is reported on its own and a bad broker connection costs only
  // that account its day.
  const results: { slug: string; captured: boolean; reason?: string }[] = [];
  for (const portfolio of await listPortfolios(db)) {
    if (await hasSnapshot(db, portfolio.id, date)) {
      results.push({ slug: portfolio.slug, captured: false, reason: "Already recorded" });
      continue;
    }
    try {
      await loadPortfolio(portfolio.id, now);
      const captured = await hasSnapshot(db, portfolio.id, date);
      results.push({
        slug: portfolio.slug,
        captured,
        ...(captured ? {} : { reason: "No fresh portfolio data; retry later" }),
      });
    } catch {
      results.push({ slug: portfolio.slug, captured: false, reason: "Capture failed" });
    }
  }

  const captured = results.filter((r) => r.captured).length;
  return Response.json(
    { date, captured, results },
    // A partial failure is still a failure worth retrying, but only when
    // nothing at all was recorded and something was expected to be.
    { status: captured > 0 || results.length === 0 ? 200 : 503 },
  );
}
