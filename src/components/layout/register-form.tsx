"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Help } from "@/components/ui/help";
import { PasswordInput } from "@/components/ui/password-input";
import { useT } from "@/lib/i18n/context";
import { MIN_PASSWORD_LENGTH } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Open sign-up, but the account is inert until somebody approves it — so the
 * form says so before it is filled in rather than after it is submitted.
 */
export function RegisterForm({ ownerName }: { ownerName: string }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checked as it is typed, so a password that is too short, or a second
  // copy that does not match, is visible before Submit rather than after.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const short = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const isUsername = password.length > 0 && password.toLowerCase() === username.trim().toLowerCase();
  const mismatch = confirm.length > 0 && confirm !== password;
  const passwordReady =
    password.length >= MIN_PASSWORD_LENGTH && !isUsername && confirm === password;
  const owner = (text: string) => text.replaceAll("{owner}", ownerName);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordReady) {
      setError(
        password.length < MIN_PASSWORD_LENGTH
          ? t.register.passwordHint
          : isUsername
            ? t.register.passwordIsUsername
            : t.register.mismatch,
      );
      return;
    }
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
            value={username}
            onChange={(event) => setUsername(event.target.value)}
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
          <span className="flex items-center gap-1">
            <Label htmlFor="password" className="text-xs text-muted-foreground">
              {t.register.password}
            </Label>
            <Help title={t.register.passwordSafetyTitle}>
              {owner(t.register.passwordSafetyBody)}
            </Help>
          </span>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="password-status"
            required
          />
          <p
            id="password-status"
            aria-live="polite"
            className={cn(
              "text-xs",
              short || isUsername
                ? "text-negative"
                : password.length >= MIN_PASSWORD_LENGTH
                  ? "text-positive"
                  : "text-muted-foreground",
            )}
          >
            {isUsername
              ? t.register.passwordIsUsername
              : short
                ? t.register.passwordShort.replace(
                    "{n}",
                    String(MIN_PASSWORD_LENGTH - password.length),
                  )
                : password.length >= MIN_PASSWORD_LENGTH
                  ? t.register.passwordOk
                  : t.register.passwordHint}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword" className="text-xs text-muted-foreground">
            {t.register.confirm}
          </Label>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-describedby="confirm-status"
            required
          />
          {confirm.length > 0 && (
            <p
              id="confirm-status"
              aria-live="polite"
              className={cn("text-xs", mismatch ? "text-negative" : "text-positive")}
            >
              {mismatch ? t.register.mismatch : t.register.match}
            </p>
          )}
        </div>

        {/* The one thing the forgotten-password screen can offer without an
            owner stepping in. Required, and refused if it gives the password
            away. Why it is asked for sits behind the question mark, because
            "what if I forget?" is the question it answers. */}
        <div className="space-y-2">
          <span className="flex items-center gap-1">
            <Label htmlFor="passwordHint" className="text-xs text-muted-foreground">
              {t.register.hint}
            </Label>
            <Help title={t.register.hintWhyTitle}>{owner(t.register.hintWhyBody)}</Help>
          </span>
          <Input id="passwordHint" name="passwordHint" autoComplete="off" maxLength={100} required />
          <p className="text-xs text-muted-foreground">{t.register.hintHelp}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="referredBy" className="text-xs text-muted-foreground">
            {t.pending.referredBy}{" "}
            <span className="text-muted-foreground/70">({t.register.optional})</span>
          </Label>
          <Input id="referredBy" name="referredBy" autoComplete="off" />
          <p className="text-xs text-muted-foreground">{t.pending.referredByHint}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reason" className="text-xs text-muted-foreground">
            {t.pending.reason}{" "}
            <span className="text-muted-foreground/70">({t.register.optional})</span>
          </Label>
          {/* Optional, with no minimum. Insisting on a sentence stopped people
              signing up; whoever approves can always ask. */}
          <textarea
            id="reason"
            name="reason"
            rows={2}
            maxLength={500}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-base transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-muted-foreground/40 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/10"
          />
          <p className="text-xs text-muted-foreground">{t.pending.reasonHint}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs text-muted-foreground">
            {t.pending.email}{" "}
            <span className="text-muted-foreground/70">({t.register.optional})</span>
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

        <Button type="submit" className="mt-1 w-full" disabled={pending || !passwordReady}>
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
