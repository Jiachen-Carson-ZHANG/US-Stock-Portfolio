"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/lib/i18n/context";
import { loginAction, type LoginState } from "@/app/login/actions";

function SubmitButton() {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t.login.signingIn : t.login.signIn}
    </Button>
  );
}

export function LoginForm() {
  const t = useT();
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <Card>
      <CardContent className="pt-5">
        {/* A Server Action, so credentials always POST and never reach the URL. */}
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">{t.login.username}</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{t.login.password}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {state.error && (
            <p role="alert" className="text-sm text-negative">
              {state.error}
            </p>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
