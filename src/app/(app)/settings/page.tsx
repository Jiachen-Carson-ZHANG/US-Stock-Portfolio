import { requireOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { activeProvider } from "@/providers";
import { loadPortfolio } from "@/lib/portfolio/service";
import { SyncButton, UserRows } from "@/components/layout/settings-actions";
import { Badge } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  active_sessions: number;
};

function readUsers() {
  return getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role,
              (SELECT COUNT(*) FROM sessions s
                WHERE s.user_id = u.id
                  AND s.revoked_at IS NULL
                  AND s.expires_at > ?) AS active_sessions
       FROM users u
       ORDER BY CASE u.role WHEN 'owner' THEN 0 ELSE 1 END, u.username`,
    )
    .all(new Date().toISOString()) as UserRow[];
}

export default async function SettingsPage() {
  await requireOwner();

  const provider = activeProvider();
  const { summary, positions } = await loadPortfolio();
  const users = readUsers();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Owner only.</p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Data source</h2>
          <Badge>{provider}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Positions stored</dt>
            <dd className="mt-1 text-sm font-medium">{positions.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Quote status</dt>
            <dd className="mt-1 text-sm font-medium">
              {summary.isStale ? "Stale" : "Current"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Market</dt>
            <dd className="mt-1 text-sm font-medium">{summary.marketStatus}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last quote</dt>
            <dd className="tabular mt-1 text-sm font-medium">
              {summary.dataTimestamp
                ? new Date(summary.dataTimestamp).toLocaleTimeString()
                : "—"}
            </dd>
          </div>
        </dl>

        {provider === "mock" && (
          <p className="mt-4 text-xs text-muted-foreground">
            Showing synthetic holdings. Broker connection is not implemented yet.
          </p>
        )}

        <div className="mt-5">
          <SyncButton />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">Accounts</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Revoking sessions signs that person out on every device.
        </p>
        <UserRows
          users={users.map((user) => ({
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            role: user.role,
            activeSessions: user.active_sessions,
          }))}
        />
      </section>
    </div>
  );
}
