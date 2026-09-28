import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import { LoginForm } from "@/components/layout/login-form";
import { LanguageToggle } from "@/components/layout/nav";
import { BrandMark } from "@/components/layout/brand-mark";
import { GoogleButton } from "@/components/layout/google-button";
import { googleConfigured } from "@/lib/auth/google";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  // A waiting account is signed in already; showing it the form again is how
  // somebody ends up typing a correct password over and over.
  const signedIn = await getSessionUser();
  if (signedIn) redirect(signedIn.status === "active" ? "/" : "/pending");
  const { locale, t } = await serverDictionary();
  const google = googleConfigured();
  const status = {
    cancelled: t.login.googleCancelled,
    failed: t.login.googleFailed,
    unavailable: t.login.googleUnavailable,
  }[(await searchParams).google ?? ""];

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

          {status && (
            <p role="status" className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
              {status}
            </p>
          )}
          {google && (
            <div className="mb-4 space-y-3">
              <GoogleButton label={t.login.googleButton} />
              <p className="text-center text-xs text-muted-foreground">{t.login.googleOr}</p>
            </div>
          )}

          <LoginForm />

          {google && <p className="mt-4 text-center text-xs text-muted-foreground">{t.login.googleNote}</p>}

          <div className="mt-6 flex justify-center">
            <LanguageToggle className="min-h-9 rounded-full border border-border bg-surface px-3.5 text-xs" />
          </div>
        </div>
      </main>
    </LocaleProvider>
  );
}
