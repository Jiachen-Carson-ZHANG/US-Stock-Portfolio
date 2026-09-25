import { redirect } from "next/navigation";
import { getSessionUser, isOpenAccess } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import { RegisterForm } from "@/components/layout/register-form";
import { LanguageToggle } from "@/components/layout/nav";
import { BrandMark } from "@/components/layout/brand-mark";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // Without sign-in there are no accounts to create, so the page would be a
  // form that cannot do anything.
  if (isOpenAccess()) redirect("/");
  const signedIn = await getSessionUser();
  if (signedIn) redirect(signedIn.status === "active" ? "/" : "/pending");

  // Named in the help about forgotten passwords: "ask Carson" is something a
  // person can act on, "ask the owner" is a riddle. The forgotten-password
  // screen already says the same to anyone who asks.
  //
  // Never waited on for long. This page did not use to touch the database,
  // and a sign-up form that hangs while the database wakes is worse than
  // one that says "the owner".
  const [{ locale, t }, ownerName] = await Promise.all([
    serverDictionary(),
    Promise.race([
      getDb()
        .then((db) =>
          db.get<{ display_name: string }>(
            `SELECT display_name FROM users
              WHERE role = 'owner' AND status = 'active' AND disabled_at IS NULL
              ORDER BY created_at LIMIT 1`,
          ),
        )
        .then((row) => row?.display_name ?? null)
        .catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
    ]),
  ]);

  return (
    <LocaleProvider locale={locale}>
      <main className="auth-field flex min-h-dvh flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[22rem]">
          <div className="mb-9 flex flex-col items-center text-center">
            <BrandMark className="size-12" />
            <h1 className="mt-5 text-[1.375rem] font-semibold tracking-tight">
              {t.register.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t.register.subtitle}
            </p>
          </div>

          <RegisterForm ownerName={ownerName ?? t.register.theOwner} />

          <div className="mt-6 flex justify-center">
            <LanguageToggle className="min-h-9 rounded-full border border-border bg-surface px-3.5 text-xs" />
          </div>
        </div>
      </main>
    </LocaleProvider>
  );
}
