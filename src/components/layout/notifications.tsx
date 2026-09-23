"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Notification } from "@/lib/notifications";

function ago(iso: string, justNow: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return justNow;
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
  const t = useT();
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

  const [deciding, setDeciding] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * Answers a request without leaving the bell.
   *
   * The whole point is that "somebody wants in" and "yes" should be one
   * gesture rather than a trip to a settings page to find the same name
   * again. The answer is written onto the notification, so the list keeps
   * saying what you decided instead of the question quietly vanishing.
   */
  async function decide(id: string, approve: boolean) {
    setDeciding(id);
    setFailed(null);
    try {
      const response = await fetch("/api/notifications/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id, approve }),
      });
      if (!response.ok) {
        setFailed(id);
        return;
      }
      setItems((current) =>
        current?.map((item) =>
          item.id === id
            ? {
                ...item,
                decision: approve ? "approved" : "declined",
                decidedAt: new Date().toISOString(),
                readAt: item.readAt ?? new Date().toISOString(),
              }
            : item,
        ) ?? null,
      );
      setUnread((count) => Math.max(0, count - 1));
      router.refresh();
    } finally {
      setDeciding(null);
    }
  }

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
        aria-label={`${t.notifications.title}${unread > 0 ? ` (${unread})` : ""}`}
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
            <p className="text-xs font-medium">{t.notifications.title}</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t.notifications.markAllRead}
              </button>
            )}
          </div>

          {items === null ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t.notifications.empty}</p>
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
                      {ago(item.createdAt, t.notifications.justNow)}
                    </p>
                  </div>
                );
                // Only two kinds ask a question, and only while nobody has
                // answered it yet. Everything else stays a plain line you can
                // click through.
                const askable =
                  (item.kind === "account_request" || item.kind === "access_request") &&
                  item.subjectId !== null;

                if (askable) {
                  return (
                    <li key={item.id}>
                      {content}
                      <div className="flex items-center gap-2 px-2 pb-2">
                        {item.decision ? (
                          <p className="text-xs text-muted-foreground">
                            {item.decision === "approved"
                              ? t.notifications.approved
                              : t.notifications.declined}
                          </p>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={deciding === item.id}
                              onClick={() => void decide(item.id, true)}
                              className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background disabled:opacity-60"
                            >
                              {deciding === item.id
                                ? t.notifications.deciding
                                : t.notifications.approve}
                            </button>
                            <button
                              type="button"
                              disabled={deciding === item.id}
                              onClick={() => void decide(item.id, false)}
                              className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-60"
                            >
                              {t.notifications.decline}
                            </button>
                          </>
                        )}
                        {item.link && (
                          <Link
                            href={item.link}
                            onClick={() => setOpen(false)}
                            className="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                          >
                            {t.notifications.view}
                          </Link>
                        )}
                      </div>
                      {failed === item.id && (
                        <p className="px-2 pb-2 text-xs text-negative">
                          {t.notifications.decideFailed}
                        </p>
                      )}
                    </li>
                  );
                }

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
