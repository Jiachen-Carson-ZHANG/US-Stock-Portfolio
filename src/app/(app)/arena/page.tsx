import { requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { allLeaderboards } from "@/lib/arena";
import { trophiesFor } from "@/lib/arena/trophies";
import { visibleTo } from "@/lib/portfolios";
import { ArenaBoard } from "@/components/arena/board";
import { EmptyState } from "@/components/ui/misc";
import { serverDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function ArenaPage() {
  const user = await requireUser();
  const { t } = await serverDictionary();
  const db = await getDb();
  const boards = await allLeaderboards(db, user);
  const visible = await visibleTo(db, user);
  const trophies = await trophiesFor(db, visible.map((p) => p.id));

  if (boards.max.standings.length < 2) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">{t.arena.title}</h1>
        <EmptyState
          title={t.arena.emptyTitle}
          description={t.arena.emptyBody}
        />
      </div>
    );
  }

  return <ArenaBoard boards={boards} trophies={trophies} />;
}
