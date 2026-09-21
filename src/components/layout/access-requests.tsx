"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/context";
import type { AccessRequest } from "@/lib/access";

/**
 * Requests waiting on you, as the person whose portfolio it is.
 *
 * Deliberately on your own account page rather than in administrator
 * settings: the decision belongs to whose money it is, not to whoever runs
 * the deployment.
 */
export function AccessRequests({ requests }: { requests: AccessRequest[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    await fetch("/api/access-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: id, approve }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">{t.access.waiting}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.access.waitingNote}
      </p>

      <ul className="mt-4 divide-y divide-border">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{request.userName}</span>{" "}
                {t.access.wouldLikeToSee} {request.portfolioName}
              </p>
              {request.message && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  “{request.message}”
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy === request.id}
                onClick={() => decide(request.id, true)}
              >
                {t.access.share}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === request.id}
                onClick={() => decide(request.id, false)}
              >
                {t.access.decline}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
