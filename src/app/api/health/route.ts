import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness, and a way to keep the database awake.
 *
 * Neon's free tier suspends the compute after about five minutes idle, so the
 * first visitor after a quiet evening waits for it to start. A ping every few
 * minutes resets that timer for the cost of one trivial query.
 *
 * Unauthenticated on purpose — an external pinger has no session — so it is
 * built to give away nothing: no version, no counts, no configuration, and a
 * single `SELECT 1` rather than anything that touches real rows. A failure
 * says only that the database is unreachable, which is what a monitor needs
 * and an attacker could learn by loading the site anyway.
 */
export async function GET() {
  const started = Date.now();

  try {
    const db = await getDb();
    await db.get(`SELECT 1 AS ok`);
    return Response.json(
      { ok: true, db: "up", ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, db: "down" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
