"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";

/**
 * Showing somebody the reminder they wrote for themselves.
 *
 * Two outcomes and one fallback. Either there is a hint, and it is shown; or
 * there is not, and the answer is the same whether the name exists or not.
 * Both end with who to ask, by name, because "contact an administrator" is
 * advice nobody can act on.
 */
export function ForgotForm() {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<
    { kind: "hint"; hint: string; owner: string | null } | { kind: "none"; owner: string | null } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = String(new FormData(event.currentTarget).get("username") ?? "");

    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/auth/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (response.status === 429) {
        setError(t.forgot.tooMany);
        return;
      }
      const body = await response.json().catch(() => ({}));
      setResult(
        body.hint
          ? { kind: "hint", hint: body.hint, owner: body.owner ?? null }
          : { kind: "none", owner: body.owner ?? null },
      );
    } finally {
      setPending(false);
    }
  }

  const askOwner = (owner: string | null) =>
    t.forgot.askOwner.replace("{owner}", owner ?? "the site owner");

  return (
    <div className="elevated rounded-2xl border border-border bg-surface p-6 sm:p-7">
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="username" className="text-xs text-muted-foreground">
            {t.forgot.username}
          </Label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}

        {result?.kind === "hint" && (
          <div role="status" className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">{t.forgot.yourHint}</p>
            <p className="mt-1 text-sm font-medium">{result.hint}</p>
          </div>
        )}
        {result?.kind === "none" && (
          <p role="status" className="text-sm text-muted-foreground">
            {t.forgot.noHint}
          </p>
        )}
        {result && (
          <p className="text-xs leading-relaxed text-muted-foreground">{askOwner(result.owner)}</p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {t.forgot.show}
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        <Link href="/login" className="underline underline-offset-4">
          {t.forgot.back}
        </Link>
      </p>
    </div>
  );
}
