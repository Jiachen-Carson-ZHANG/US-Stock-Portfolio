"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

const MIN_LENGTH = 10;

type Result = { tone: "ok" | "bad"; message: string };

/**
 * Changing your own password.
 *
 * The confirmation field is checked here rather than server-side: it guards
 * against a typo, which is a client concern, and sending it would only put a
 * second copy of the password on the wire.
 */
export function ChangePassword() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setResult({ tone: "bad", message: "The two new passwords do not match." });
      return;
    }
    if (newPassword.length < MIN_LENGTH) {
      setResult({
        tone: "bad",
        message: `Use at least ${MIN_LENGTH} characters.`,
      });
      return;
    }

    setPending(true);
    setResult(null);

    const response = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setResult({ tone: "bad", message: body.error ?? "Could not change the password." });
      return;
    }

    form.reset();
    setResult({
      tone: "ok",
      message:
        body.revoked > 0
          ? `Password changed. Signed out of ${body.revoked} other session${
              body.revoked === 1 ? "" : "s"
            }.`
          : "Password changed.",
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-sm space-y-4">
      {/* Tells a password manager which account this belongs to. */}
      <input type="hidden" name="username" autoComplete="username" />

      <div className="space-y-2">
        <Label htmlFor="currentPassword" className="text-xs text-muted-foreground">
          Current password
        </Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword" className="text-xs text-muted-foreground">
          New password
        </Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_LENGTH} characters. Length matters more than symbols.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword" className="text-xs text-muted-foreground">
          Confirm new password
        </Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
        />
      </div>

      {result && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            result.tone === "ok"
              ? "border-positive/30 bg-positive/5 text-positive"
              : "border-negative/30 bg-negative/5 text-negative"
          }`}
        >
          {result.message}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
