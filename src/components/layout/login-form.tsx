"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { useT } from "@/lib/i18n/context";
import { loginAction, type LoginState } from "@/app/login/actions";

function SubmitButton() {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="mt-1 w-full" disabled={pending}>
      {pending ? t.login.signingIn : t.login.signIn}
    </Button>
  );
}

export function LoginForm() {
  const t = useT();
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <div className="elevated rounded-2xl border border-border bg-surface p-6 sm:p-7">
      {/* A Server Action, so credentials always POST and never reach the URL. */}
      <form action={formAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="username" className="text-xs text-muted-foreground">
            {t.login.username}
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

        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs text-muted-foreground">
            {t.login.password}
          </Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </div>

        {state.error && (
          <p
            role="alert"
            className="rounded-lg border border-negative/30 bg-negative/5 px-3 py-2 text-sm text-negative"
          >
            {state.error}
          </p>
        )}

        <SubmitButton />
      </form>

      <p className="mt-4 text-center text-xs">
        <Link href="/forgot" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
          {t.forgot.link}
        </Link>
      </p>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        {t.register.noAccount}{" "}
        <Link
          href="/register"
          className="underline underline-offset-4 hover:text-foreground"
        >
          {t.register.createOne}
        </Link>
      </p>
    </div>
  );
}
