"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  activeSessions: number;
};

export function SyncButton({ portfolioSlug }: { portfolioSlug?: string } = {}) {
  const router = useRouter();
  const [state, setState] = useState<{ pending: boolean; message: string | null }>({
    pending: false,
    message: null,
  });

  async function sync() {
    setState({ pending: true, message: null });
    const response = await fetch(`/api/portfolio/sync${portfolioSlug ? `?portfolio=${encodeURIComponent(portfolioSlug)}` : ""}`, { method: "POST" });
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

export function MoomooConnection({ connected, portfolioSlug }: { connected: boolean; portfolioSlug?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);

    const response = await fetch(`/api/broker/moomoo/connect${portfolioSlug ? `?portfolio=${encodeURIComponent(portfolioSlug)}` : ""}`, { method: "POST" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.authorizeUrl) {
      setError(data.error ?? "Could not start the moomoo connection.");
      setPending(false);
      return;
    }

    window.location.href = data.authorizeUrl;
  }

  async function disconnect() {
    setPending(true);
    const response = await fetch(`/api/broker/moomoo/disconnect${portfolioSlug ? `?portfolio=${encodeURIComponent(portfolioSlug)}` : ""}`, { method: "POST" });
    if (!response.ok) {
      setError("Could not disconnect. Please try again.");
      setPending(false);
      return;
    }
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={connect} disabled={pending}>
        {pending ? "Opening moomoo…" : connected ? "Reconnect moomoo" : "Connect moomoo"}
      </Button>

      {connected && (
        <Button variant="ghost" onClick={disconnect} disabled={pending}>
          Disconnect
        </Button>
      )}

      {error && <p className="text-sm text-negative">{error}</p>}
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
export function RebuildHistory() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function rebuild() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/rebuild", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error ?? "The rebuild could not finish.");
        return;
      }
      setMessage(
        data.written === 0
          ? "Nothing to add — every day was already recorded."
          : `Rebuilt ${data.written} ${data.written === 1 ? "day" : "days"}.`,
      );
      router.refresh();
    } catch {
      setMessage("The rebuild could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={rebuild} disabled={pending}>
        {pending ? "Rebuilding…" : "Rebuild history from trades"}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
