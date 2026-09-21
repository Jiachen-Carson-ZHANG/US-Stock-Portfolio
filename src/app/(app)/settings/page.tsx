import { requireOwner } from "@/lib/auth/guards";
import { requirePortfolio } from "@/lib/portfolios/context";
import { getDb } from "@/lib/db";
import { activeProvider } from "@/providers";
import { loadPortfolio } from "@/lib/portfolio/service";
import { readConnectionStatus } from "@/lib/moomoo/tokens";
import {
  MoomooConnection,
  SyncButton,
  UserRows,
} from "@/components/layout/settings-actions";
import { Badge } from "@/components/ui/misc";
import { FamilyActivity } from "@/components/layout/family-activity";
import { activityByMember, mostViewedAssets } from "@/lib/activity";

const CONNECT_OUTCOME: Record<string, { tone: "ok" | "bad"; message: string }> = {
  connected: { tone: "ok", message: "moomoo connected and holdings synced." },
  connected_sync_failed: {
    tone: "bad",
    message: "Connected, but the first sync failed. Try Sync holdings now.",
  },
  write_scope: {
    tone: "bad",
    message:
      "Connection refused: a write permission was granted, so nothing was saved. " +
      "On moomoo's screen tick only Market Data and Accounts & Orders. " +
      "Watchlists and Trade Execution both grant write access.",
  },
  state_mismatch: {
    tone: "bad",
    message: "Authorization could not be verified. Start the connection again.",
  },
  denied: { tone: "bad", message: "Authorization was cancelled." },
  failed: { tone: "bad", message: "Could not connect to moomoo." },
};

export const dynamic = "force-dynamic";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  active_sessions: number;
};

async function readUsers(): Promise<UserRow[]> {
  const db = await getDb();
  // COUNT is bigint, which the driver returns as a string unless it is cast.
  return db.all<UserRow>(
    `SELECT u.id, u.username, u.display_name, u.role,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.user_id = u.id
                AND s.revoked_at IS NULL
                AND s.expires_at > ?)::int AS active_sessions
       FROM users u
      ORDER BY CASE u.role WHEN 'owner' THEN 0 ELSE 1 END, u.username`,
    [new Date().toISOString()],
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ moomoo?: string }>;
}) {
  await requireOwner();
  const { portfolio } = await requirePortfolio();

  const provider = await activeProvider(portfolio.id);
  const { summary, positions } = await loadPortfolio(portfolio.id);
  const db = await getDb();
  const users = await readUsers();
  const connection = await readConnectionStatus(db, portfolio.id);
  const mostViewed = await mostViewedAssets(db);
  const byMember = await activityByMember(db);
  const outcome = CONNECT_OUTCOME[(await searchParams).moomoo ?? ""];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Owner only.</p>
      </header>

      {outcome && (
        <p
          role="status"
          className={`rounded-lg border border-border px-4 py-3 text-sm ${
            outcome.tone === "ok" ? "text-positive" : "text-negative"
          }`}
        >
          {outcome.message}
        </p>
      )}

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Broker connection</h2>
          <Badge>{connection ? connection.status : "not connected"}</Badge>
        </div>

        {connection ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Granted scopes</dt>
              <dd className="mt-1 text-sm font-medium">{connection.scope || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Account</dt>
              <dd className="mt-1 text-sm font-medium">
                {connection.accountId ? `••••${connection.accountId.slice(-4)}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Token refreshed</dt>
              <dd className="mt-1 text-sm font-medium">
                {connection.lastRefreshAt
                  ? new Date(connection.lastRefreshAt).toLocaleString()
                  : "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Connect a moomoo account to replace the synthetic holdings. Only
            read access is requested, and a write grant is refused.
          </p>
        )}

        <div className="mt-5">
          <MoomooConnection connected={connection !== null} />
        </div>
      </section>

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
            Showing synthetic holdings. Connecting a moomoo account switches
            this over automatically.
          </p>
        )}

        <div className="mt-5">
          <SyncButton />
        </div>
      </section>

      <FamilyActivity mostViewed={mostViewed} byMember={byMember} />

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
