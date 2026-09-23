"use client";

import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * Following somebody.
 *
 * Deliberately not a request, because it grants nothing. What a follower is
 * told about is filtered by what they could already see, so this only decides
 * whether a bell rings — never what is behind a locked door.
 */
export function FollowButton({
  userId,
  initiallyFollowing,
}: {
  userId: string;
  initiallyFollowing: boolean;
}) {
  const t = useT();
  const [on, setOn] = useState(initiallyFollowing);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    // Shown at once and put back if the server disagrees. A bell subscription
    // is not worth making somebody watch a spinner for.
    setOn(next);
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, follow: next }),
      });
      if (!response.ok) setOn(!next);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={on}
      title={t.feed.followHint}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors disabled:opacity-60",
        on
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {on ? (
        <Bell className="size-3.5" aria-hidden="true" />
      ) : (
        <BellOff className="size-3.5" aria-hidden="true" />
      )}
      {on ? t.feed.following : t.feed.follow}
    </button>
  );
}
