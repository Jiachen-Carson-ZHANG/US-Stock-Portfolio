"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/**
 * What you see when you open a portfolio that is not yours.
 *
 * Says plainly that it exists and is not shared with you, and offers to ask.
 * The alternative — a flat 404 — hides that the address is taken, which is
 * the safer default in general but the wrong one here: among five family
 * members, being able to ask is worth more than concealing that a sister
 * has an account.
 */
export function RequestAccess({
  slug,
  name,
  ownerName,
  alreadyAsked,
}: {
  slug: string;
  name: string;
  ownerName: string | null;
  alreadyAsked: boolean;
}) {
  const [asked, setAsked] = useState(alreadyAsked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = String(new FormData(event.currentTarget).get("message") ?? "");

    setBusy(true);
    setError(null);
    const response = await fetch("/api/access-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, message }),
    });
    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Could not send the request.");
      return;
    }
    setAsked(true);
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 py-8">
      <div className="flex items-center gap-3">
        <Lock className="size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold tracking-tight">{name} is private</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        This portfolio exists, but it is not shared with you.
        {ownerName ? ` ${ownerName} decides who can see it.` : ""}
      </p>

      {asked ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface px-4 py-3 text-sm"
        >
          Your request has been sent{ownerName ? ` to ${ownerName}` : ""}. You
          will get a notification either way.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="message" className="text-xs text-muted-foreground">
              Say why, if you like
            </Label>
            <Input id="message" name="message" placeholder="Optional" />
          </div>

          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Ask for access"}
          </Button>
        </form>
      )}
    </div>
  );
}
