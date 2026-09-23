import { isOpenAccess, requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { AccessRequests } from "@/components/layout/access-requests";
import { DisplayName } from "@/components/account/display-name";
import { ChangePassword } from "@/components/layout/account-actions";
import { pendingRequestsFor } from "@/lib/access";
import { Badge } from "@/components/ui/misc";
import { serverDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;


type SecurityEvent = {
  kind: string;
  detail: string | null;
  created_at: string;
};

export default async function AccountPage() {
  const user = await requireUser();
  const { t } = await serverDictionary();
  const open = isOpenAccess();

  const db = await getDb();
  const sessions = open
    ? 0
    : ((
        await db.get<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM sessions
            WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
          [user.id, new Date().toISOString()],
        )
      )?.n ?? 0);

  const events = open
    ? []
    : await db.all<SecurityEvent>(
        `SELECT kind, detail, created_at FROM activity_events
          WHERE user_id = ? AND kind IN ('login','logout','password_change')
          ORDER BY created_at DESC LIMIT 8`,
        [user.id],
      );

  const requests = open ? [] : await pendingRequestsFor(db, user.id);

  const eventLabel: Record<string, string> = {
    login: t.account.signedIn,
    logout: t.account.signedOut,
    password_change: t.account.passwordChangedEvent,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t.account.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user.displayName} · @{user.username}
        </p>
      </header>

      <AccessRequests requests={requests} />

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">{t.account.displayName}</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          {t.account.displayNameNote}
        </p>
        <DisplayName current={user.displayName} />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t.account.password}</h2>
          <Badge>{user.role}</Badge>
        </div>

        {open ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t.account.openAccess}
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              {t.account.passwordNote}
            </p>
            <ChangePassword />
          </>
        )}
      </section>

      {!open && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{t.account.activity}</h2>
            <Badge>
              {sessions} {t.account.activeSessions}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.account.activityNote}
          </p>

          {events.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t.account.nothingYet}</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {events.map((event, index) => (
                <li
                  key={`${event.created_at}-${index}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-sm">
                    {eventLabel[event.kind] ?? event.kind}
                    {event.detail && (
                      <span className="text-muted-foreground"> · {event.detail}</span>
                    )}
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
