"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * A password field whose contents can be shown.
 *
 * On a phone keyboard a typo in a hidden password stays invisible until the
 * sign-in fails; being able to look is how people check what they typed.
 * Autocorrect and capitalisation stay off either way, or showing it would
 * let the keyboard "fix" it.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const t = useT();
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-11", className)}
      />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? t.login.hidePassword : t.login.showPassword}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground"
      >
        {shown ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
