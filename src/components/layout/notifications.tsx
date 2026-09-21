"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Notification } from "@/lib/notifications";

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The bell.
 *
 * Loads on open rather than on every page render: nothing here is urgent
 * enough to justify a request on each navigation, and an unread count that
 * is a minute stale has never mattered.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!open || items) return;
    let cancelled = false;
    void fetch("/api/notifications")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        setItems(body.notifications);
        setUnread(body.unread);
      });
    return () => {
      cancelled = true;
    };
  }, [open, items]);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setUnread(0);
    setItems((current) =>
      current?.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) ??
      null,
    );
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 size-2 rounded-full bg-negative" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs font-medium">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            )}
          </div>

          {items === null ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => {
                const content = (
                  <div
                    className={cn(
                      "rounded-lg px-2 py-2",
                      !item.readAt && "bg-muted/60",
                    )}
                  >
                    <p className="text-sm">{item.title}</p>
                    {item.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ago(item.createdAt)}
                    </p>
                  </div>
                );
                return (
                  <li key={item.id}>
                    {item.link ? (
                      <Link href={item.link} onClick={() => setOpen(false)}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
