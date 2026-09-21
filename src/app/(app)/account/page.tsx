import { isOpenAccess, requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { ChangePassword } from "@/components/layout/account-actions";
import { Badge } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

type SecurityEvent = {
  kind: string;
  detail: string | null;
  created_at: string;
};

const EVENT_LABEL: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  password_change: "Password changed",
};

export default async function AccountPage() {
  const user = await requireUser();
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user.displayName} · @{user.username}
        </p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Password</h2>
          <Badge>{user.role}</Badge>
        </div>

        {open ? (
          <p className="mt-2 text-xs text-muted-foreground">
            This deployment runs without sign-in, so there is no password to
            change. Set AUTH_MODE=password to enable accounts.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Only you can change this. Passwords are stored as Argon2id
              hashes, which cannot be read back — not by another family member,
              and not by whoever runs the server. Changing it signs out your
              other devices.
            </p>
            <ChangePassword />
          </>
        )}
      </section>

      {!open && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Recent account activity</h2>
            <Badge>
              {sessions} active session{sessions === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Sign-ins and password changes on your account. An entry you do not
            recognise is worth asking about.
          </p>

          {events.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {events.map((event, index) => (
                <li
                  key={`${event.created_at}-${index}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-sm">
                    {EVENT_LABEL[event.kind] ?? event.kind}
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
