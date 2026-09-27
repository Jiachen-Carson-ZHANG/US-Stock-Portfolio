"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/context";

/**
 * "Connect my moomoo account", for anybody.
 *
 * Makes the person's own real account if they have none, then takes them to
 * its connection page — where the checklist of what to tick on moomoo's
 * screen is, and the button that opens it.
 */
export function OwnBrokerageButton() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    setBusy(true);
    setFailed(false);
    const response = await fetch("/api/me/brokerage", { method: "POST" }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    if (!body?.slug) {
      setBusy(false);
      setFailed(true);
      return;
    }
    router.push(`/${body.slug}/connection`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={start} disabled={busy}>
        {busy ? t.account.brokerCreating : t.account.brokerCreate}
      </Button>
      {failed && <p className="text-sm text-negative">{t.connection.outcomeFailed}</p>}
    </div>
  );
}
