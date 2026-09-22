import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import { LoginForm } from "@/components/layout/login-form";
import { LanguageToggle } from "@/components/layout/nav";
import { BrandMark } from "@/components/layout/brand-mark";

export default async function LoginPage() {
  // A waiting account is signed in already; showing it the form again is how
  // somebody ends up typing a correct password over and over.
  const signedIn = await getSessionUser();
  if (signedIn) redirect(signedIn.status === "active" ? "/" : "/pending");
  const { locale, t } = await serverDictionary();

  return (
    <LocaleProvider locale={locale}>
      <main className="auth-field flex min-h-dvh flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[22rem]">
          <div className="mb-9 flex flex-col items-center text-center">
            <BrandMark className="size-12" />
            <h1 className="mt-5 text-[1.375rem] font-semibold tracking-tight">
              {t.login.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t.login.subtitle}
            </p>
          </div>

          <LoginForm />

          <div className="mt-6 flex justify-center">
            <LanguageToggle className="min-h-9 rounded-full border border-border bg-surface px-3.5 text-xs" />
          </div>
        </div>
      </main>
    </LocaleProvider>
  );
}
