"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";
import { MIN_PASSWORD_LENGTH } from "@/lib/schemas";

/**
 * Open sign-up, but the account is inert until somebody approves it — so the
 * form says so before it is filled in rather than after it is submitted.
 */
export function RegisterForm() {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

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
        reason: String(data.get("reason") ?? ""),
        email: String(data.get("email") ?? ""),
        passwordHint: String(data.get("passwordHint") ?? ""),
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
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <p className="text-xs text-muted-foreground">{t.register.passwordHint}</p>
        </div>

        {/* The one thing the forgotten-password screen can offer without an
            owner stepping in. Required, and refused if it gives the password
            away. */}
        <div className="space-y-2">
          <Label htmlFor="passwordHint" className="text-xs text-muted-foreground">
            {t.register.hint}
          </Label>
          <Input id="passwordHint" name="passwordHint" autoComplete="off" maxLength={100} required />
          <p className="text-xs text-muted-foreground">{t.register.hintHelp}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="referredBy" className="text-xs text-muted-foreground">
            {t.pending.referredBy}
          </Label>
          <Input id="referredBy" name="referredBy" autoComplete="off" />
          <p className="text-xs text-muted-foreground">{t.pending.referredByHint}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason" className="text-xs text-muted-foreground">
            {t.pending.reason}
          </Label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            minLength={MIN_PASSWORD_LENGTH}
            required
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-base transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-muted-foreground/40 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/10"
          />
          <p className="text-xs text-muted-foreground">{t.pending.reasonHint}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs text-muted-foreground">
            {t.pending.email}
          </Label>
          <Input id="email" name="email" type="email" autoComplete="email" />
          <p className="text-xs text-muted-foreground">{t.pending.emailHint}</p>
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
