"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";

/**
 * Open sign-up, but the account is inert until somebody approves it — so the
 * form says so before it is filled in rather than after it is submitted.
 */
const REASON_KEYS = [
  "family",
  "friend",
  "learning",
  "compare",
  "curious",
  "other",
] as const;

export function RegisterForm() {
  const t = useT();
  const [reasons, setReasons] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    if (reasons.length === 0) {
      setError(t.pending.reasonsHint);
      return;
    }

    setPending(true);
    setError(null);
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(data.get("username") ?? ""),
        displayName: String(data.get("displayName") ?? ""),
        password: String(data.get("password") ?? ""),
        referredBy: String(data.get("referredBy") ?? ""),
        reasons,
        intro: String(data.get("intro") ?? ""),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setError(body.error ?? t.register.failed);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="elevated rounded-2xl border border-border bg-surface p-6 sm:p-7">
        <p role="status" className="text-sm">
          {t.register.done}
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {t.register.signIn}
        </Link>
      </div>
    );
  }

  return (
    <div className="elevated rounded-2xl border border-border bg-surface p-6 sm:p-7">
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="username" className="text-xs text-muted-foreground">
            {t.register.username}
          </Label>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
          />
          <p className="text-xs text-muted-foreground">{t.register.usernameHint}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="displayName" className="text-xs text-muted-foreground">
            {t.register.displayName}
          </Label>
          <Input id="displayName" name="displayName" autoComplete="name" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs text-muted-foreground">
            {t.register.password}
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
          <p className="text-xs text-muted-foreground">{t.register.passwordHint}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="referredBy" className="text-xs text-muted-foreground">
            {t.pending.referredBy}
          </Label>
          <Input id="referredBy" name="referredBy" autoComplete="off" />
          <p className="text-xs text-muted-foreground">{t.pending.referredByHint}</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs text-muted-foreground">{t.pending.reasons}</legend>
          <div className="space-y-1.5">
            {REASON_KEYS.map((key) => {
              const label = {
                family: t.pending.reasonFamily,
                friend: t.pending.reasonFriend,
                learning: t.pending.reasonLearning,
                compare: t.pending.reasonCompare,
                curious: t.pending.reasonCurious,
                other: t.pending.reasonOther,
              }[key];
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={reasons.includes(key)}
                    onChange={(event) =>
                      setReasons((current) =>
                        event.target.checked
                          ? [...current, key]
                          : current.filter((r) => r !== key),
                      )
                    }
                  />
                  {label}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t.pending.reasonsHint}</p>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="intro" className="text-xs text-muted-foreground">
            {t.pending.intro}
          </Label>
          <Input id="intro" name="intro" autoComplete="off" />
          <p className="text-xs text-muted-foreground">{t.pending.introHint}</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-negative/30 bg-negative/5 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        )}

        <Button type="submit" className="mt-1 w-full" disabled={pending}>
          {pending ? t.register.submitting : t.register.submit}
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        {t.register.haveAccount}{" "}
        <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
          {t.register.signIn}
        </Link>
      </p>
    </div>
  );
}
