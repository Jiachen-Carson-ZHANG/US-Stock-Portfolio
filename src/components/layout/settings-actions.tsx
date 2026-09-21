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

export function UserRows({ users }: { users: AdminUser[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

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
        </li>
      ))}
    </ul>
  );
}
