import { requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { allLeaderboards } from "@/lib/arena";
import { arenaAccess } from "@/lib/arena/membership";
import { trophiesFor } from "@/lib/arena/trophies";
import { ArenaBoard } from "@/components/arena/board";
import { ArenaMembership } from "@/components/arena/membership";
import { EmptyState } from "@/components/ui/misc";
import { serverDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;

export default async function ArenaPage() {
  const user = await requireUser();
  const { t } = await serverDictionary();
  const db = await getDb();
  const access = await arenaAccess(db, user);
  const accounts = access.mine.map(({ portfolio, joined }) => ({
    slug: portfolio.slug,
    name: portfolio.displayName,
    kind: portfolio.kind,
    joined,
  }));
  const membership = (
    <ArenaMembership accounts={accounts} competing={access.members.length} locked={!access.canSee} />
  );

  // Nothing of anybody's until you are in yourself.
  if (!access.canSee) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-lg font-semibold tracking-tight">{t.arena.title}</h1>
          <p className="text-sm text-muted-foreground">{t.arena.subtitle}</p>
        </header>
        {membership}
      </div>
    );
  }

  const boards = await allLeaderboards(db, user);
  const trophies = await trophiesFor(db, access.members.map((p) => p.id));

  if (boards.max.standings.length < 2) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">{t.arena.title}</h1>
        <EmptyState title={t.arena.emptyTitle} description={t.arena.emptyBody} />
        {membership}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ArenaBoard boards={boards} trophies={trophies} />
      {membership}
    </div>
  );
}
