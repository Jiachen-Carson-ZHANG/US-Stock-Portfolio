"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/context";
import type { PendingAccount } from "@/lib/accounts";

/**
 * Who is waiting to be let in.
 *
 * The note spells out what approving actually does, because "approve" on its
 * own does not say whether it hands over the family's holdings.
 */
export function PendingAccounts({ pending }: { pending: PendingAccount[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(userId: string, approve: boolean) {
    setBusy(userId);
    await fetch("/api/admin/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, approve }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">{t.register.pending}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t.register.pendingNote}</p>

      {pending.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t.register.nobodyWaiting}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {pending.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {account.displayName}{" "}
                  <span className="font-normal text-muted-foreground">
                    @{account.username}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(account.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === account.id}
                  onClick={() => decide(account.id, true)}
                >
                  {t.register.approve}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === account.id}
                  onClick={() => decide(account.id, false)}
                >
                  {t.register.decline}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
