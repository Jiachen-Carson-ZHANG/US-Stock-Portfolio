"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";

/**
 * Changing the name you are shown under.
 *
 * The username stays as it is — it is the address, and portfolio URLs are
 * built from it. This is only the label: what appears in the sidebar, on the
 * leaderboard, and above your portfolio.
 */
export function DisplayName({ current }: { current: string }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "bad", text: body.error ?? t.account.nameFailed });
        return;
      }
      setMessage({ tone: "ok", text: t.account.nameSaved });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="display-name" className="text-xs text-muted-foreground">
          {t.account.displayName}
        </Label>
        <Input
          id="display-name"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {message && (
        <p
          role="status"
          className={`text-sm ${message.tone === "ok" ? "text-positive" : "text-negative"}`}
        >
          {message.text}
        </p>
      )}

      <Button type="submit" size="sm" disabled={busy || !name.trim() || name === current}>
        {busy ? t.common.saving : t.account.saveName}
      </Button>
    </form>
  );
}
