import { requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { allLeaderboards } from "@/lib/arena";
import { ArenaBoard } from "@/components/arena/board";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function ArenaPage() {
  const user = await requireUser();
  const boards = await allLeaderboards(await getDb(), user);

  if (boards.max.standings.length < 2) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">Arena</h1>
        <EmptyState
          title="Nobody to compete with yet"
          description="The Arena ranks every portfolio you can see. It appears once there is more than one."
        />
      </div>
    );
  }

  return <ArenaBoard boards={boards} />;
}
