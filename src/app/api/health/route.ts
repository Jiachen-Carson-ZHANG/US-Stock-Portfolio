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
 * built to give away nothing: no counts, no configuration, and a single
 * `SELECT 1` rather than anything that touches real rows. A failure says only
 * that the database is unreachable, which is what a monitor needs and an
 * attacker could learn by loading the site anyway.
 *
 * It does name the commit it was built from. "Did my push actually deploy?"
 * is otherwise unanswerable from outside, and was answered wrongly more than
 * once. A commit hash of a repository is not a version number: it maps to no
 * published vulnerability and tells an attacker nothing they could use.
 */
export async function GET() {
  const started = Date.now();

  // Vercel sets this at build time; anywhere else it is simply absent.
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null;

  try {
    const db = await getDb();

    // When the scheduler last called. Without it, "is the cron working?" can
    // only be guessed at from whether prices look fresh — which says nothing
    // when the market is shut, and the market is shut most of the time.
    const beat = await db.get<{ fetched_at: string }>(
      `SELECT fetched_at FROM series_cache WHERE key = 'cron:quotes'`,
    );
    const agoSeconds = beat
      ? Math.round((Date.now() - new Date(beat.fetched_at).getTime()) / 1000)
      : null;

    return Response.json(
      {
        ok: true,
        db: "up",
        ms: Date.now() - started,
        commit,
        // Seconds since the scheduler last called, or null if it never has.
        // Anything much over 60 means it is not running.
        cronAgo: agoSeconds,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, db: "down", commit },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
