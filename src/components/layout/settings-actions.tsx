"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/context";

type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  activeSessions: number;
};

export function SyncButton({ portfolioSlug }: { portfolioSlug: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; message: string | null }>({
    pending: false,
    message: null,
  });

  async function sync() {
    setState({ pending: true, message: null });
    const response = await fetch(`/api/portfolio/sync?portfolio=${encodeURIComponent(portfolioSlug)}`, { method: "POST" });
    const data = await response.json().catch(() => ({}));

    setState({
      pending: false,
      message: response.ok
        ? `Synced ${data.synced} positions.`
        : (data.error ?? "Synchronization failed."),
    });
    if (response.ok) router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={sync} disabled={state.pending} variant="outline">
        {state.pending ? "Syncing…" : "Sync holdings now"}
      </Button>
      {state.message && (
        <p className="text-sm text-muted-foreground">{state.message}</p>
      )}
    </div>
  );
}

/**
 * Connecting moomoo, with what to tick on moomoo's screen right beside the
 * button, wherever the button appears.
 *
 * The checklist used to live only on a page most people could not reach,
 * and the Connect button in Settings had none at all. It now comes with the
 * button, and the button stays off until the person confirms they will tick
 * only the two read permissions. The confirmation is a reminder, not the
 * protection: whatever is ticked, a grant carrying anything more is refused
 * on the way back and nothing is stored (see the callback).
 */
export function MoomooConnection({ connected, portfolioSlug }: { connected: boolean; portfolioSlug: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);

    const response = await fetch(`/api/broker/moomoo/connect?portfolio=${encodeURIComponent(portfolioSlug)}`, { method: "POST" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.authorizeUrl) {
      setError(data.error ?? t.connection.startFailed);
      setPending(false);
      return;
    }

    window.location.href = data.authorizeUrl;
  }

  async function disconnect() {
    setPending(true);
    const response = await fetch(`/api/broker/moomoo/disconnect?portfolio=${encodeURIComponent(portfolioSlug)}`, { method: "POST" });
    if (!response.ok) {
      setError(t.connection.disconnectFailed);
      setPending(false);
      return;
    }
    setPending(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Open whether connecting or reconnecting: folded away, it was the
          part people skipped, and it is the one thing to get right. */}
      <MoomooPermissionChecklist />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
        />
        <span>{t.connection.consent}</span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={connect} disabled={pending || !agreed}>
          {pending ? t.connection.opening : connected ? t.connection.reconnectButton : t.connection.connectButton}
        </Button>

        {connected && (
          <Button variant="outline" onClick={disconnect} disabled={pending}>
            {t.connection.disconnect}
          </Button>
        )}

        {error && <p className="text-sm text-negative">{error}</p>}
      </div>
    </div>
  );
}

/**
 * What to tick on moomoo's consent screen.
 *
 * A checklist because that screen is a list of checkboxes: matching its shape
 * means nobody has to translate a sentence into clicks. The two refused
 * permissions are listed as well — leaving them out invites "Select all".
 */
export function MoomooPermissionChecklist() {
  const t = useT();
  const permissions = [
    { grant: true, name: t.connection.marketData, why: t.connection.marketDataWhy },
    { grant: true, name: t.connection.accountsOrders, why: t.connection.accountsOrdersWhy },
    { grant: false, name: t.connection.watchlists, why: t.connection.watchlistsWhy },
    { grant: false, name: t.connection.tradeExecution, why: t.connection.tradeExecutionWhy },
  ];

  return (
    <div>
      <p className="text-sm font-medium">{t.connection.tickThese}</p>
      <ul className="mt-3 space-y-3">
        {permissions.map((permission) => (
          <li key={permission.name} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded ${
                permission.grant ? "bg-positive/15 text-positive" : "bg-muted text-muted-foreground"
              }`}
            >
              {permission.grant ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {permission.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {permission.grant ? t.connection.tick : t.connection.leaveUnticked}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{permission.why}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
        {t.connection.dontSelectAll} {t.connection.enforced}
      </p>
    </div>
  );
}

export function UserRows({ users, me }: { users: AdminUser[]; me: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  /**
   * Removing an account made while setting things up.
   *
   * Confirmed here and refused again on the server for an owner, for yourself,
   * and for anyone holding a portfolio that follows a real brokerage account.
   */
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  /**
   * Issuing a temporary password.
   *
   * Shown once, here, so it can be passed on — it is not stored anywhere it
   * could be read again, and the person changes it as soon as they are in.
   */
  async function reset(user: AdminUser) {
    if (
      !window.confirm(
        `Reset the password for @${user.username}? They will be signed out everywhere and get a temporary password to sign in with.`,
      )
    )
      return;

    setBusy(user.id);
    const response = await fetch(`/api/admin/users/${user.id}/reset-password`, {
      method: "POST",
    });
    const data = await response.json().catch(() => ({}));
    setBusy(null);

    if (!response.ok) {
      setDone((current) => ({ ...current, [user.id]: data.error ?? "Could not reset." }));
      return;
    }
    setIssued({ username: data.username, password: data.temporaryPassword });
  }

  async function remove(user: AdminUser) {
    if (
      !window.confirm(
        `Remove @${user.username}? Their practice portfolio, posts and history go with them, and this cannot be undone.`,
      )
    )
      return;

    setBusy(user.id);
    const response = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(null);

    if (!response.ok) {
      setDone((current) => ({ ...current, [user.id]: data.error ?? "Could not remove." }));
      return;
    }
    router.refresh();
  }

  async function revoke(user: AdminUser) {
    setBusy(user.id);
    const response = await fetch(`/api/admin/users/${user.id}/revoke-sessions`, {
      method: "POST",
    });
    const data = await response.json().catch(() => ({}));
    setBusy(null);
    setDone((current) => ({
      ...current,
      [user.id]: response.ok
        ? `Signed out of ${data.revoked} session${data.revoked === 1 ? "" : "s"}.`
        : "Could not revoke sessions.",
    }));
  }

  return (
    <>
      {issued && (
        // Shown once. Closing it is the last time anybody sees this value.
        <div
          role="status"
          className="mb-4 rounded-lg border border-border bg-muted/40 p-4"
        >
          <p className="text-sm">
            Temporary password for <span className="font-medium">@{issued.username}</span>
          </p>
          <p className="tabular mt-2 select-all rounded-md bg-background px-3 py-2 font-mono text-base tracking-wide">
            {issued.password}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Pass this on privately. It is not stored anywhere it can be read again, so copy it
            now. They sign in with it and change it on their Account page.
          </p>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="mt-3 text-xs underline underline-offset-4"
          >
            I have passed it on
          </button>
        </div>
      )}
    <ul className="divide-y divide-border">
      {users.map((user) => (
        <li
          key={user.id}
          className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {user.displayName}{" "}
              <span className="font-normal text-muted-foreground">
                @{user.username}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {user.role} · {user.activeSessions} active session
              {user.activeSessions === 1 ? "" : "s"}
              {done[user.id] ? ` · ${done[user.id]}` : ""}
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => revoke(user)}
            disabled={busy === user.id || user.activeSessions === 0}
          >
            {busy === user.id ? "Revoking…" : "Revoke sessions"}
          </Button>

          {user.role !== "owner" && (
            <button
              type="button"
              onClick={() => void reset(user)}
              disabled={busy === user.id}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Reset password
            </button>
          )}

          {user.role !== "owner" && user.id !== me && (
            <button
              type="button"
              onClick={() => void remove(user)}
              disabled={busy === user.id}
              className="text-xs text-muted-foreground hover:text-negative disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
    </>
  );
}

/**
 * Rebuilding the daily history from the trades.
 *
 * A day is only recorded if something captured it that evening, so a
 * deployment that was down, or a bug in the capture, leaves a hole. Nothing
 * is lost when that happens — every day can be re-derived from the fills —
 * but "later" has to actually happen, and this is later.
 */
type RebuildRow = { slug: string; name: string; written: number; refusals: string[] };

export function RebuildHistory() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // One line per account. A single total ("Rebuilt 17 days") hid that the
  // owner's own account had been refused while the practice accounts filled.
  const [rows, setRows] = useState<RebuildRow[]>([]);

  async function rebuild() {
    setPending(true);
    setMessage(null);
    setRows([]);
    try {
      const response = await fetch("/api/admin/rebuild", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error ?? "The rebuild could not finish.");
        return;
      }
      setRows((data.results ?? []) as RebuildRow[]);
      router.refresh();
    } catch {
      setMessage("The rebuild could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={rebuild} disabled={pending}>
        {pending ? "Rebuilding…" : "Rebuild history from trades"}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {rows.map((row) => (
            <li key={row.slug} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="font-medium">{row.name}</span>
              {row.refusals.length > 0 ? (
                <span className="text-negative">Not rebuilt. {row.refusals.join(" ")}</span>
              ) : (
                <span className="text-muted-foreground">
                  {row.written === 0
                    ? "Nothing to rebuild"
                    : `${row.written} ${row.written === 1 ? "day" : "days"} rewritten`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
