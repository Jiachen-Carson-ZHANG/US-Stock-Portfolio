import { redirect } from "next/navigation";
import { getCurrentUser, isOpenAccess } from "@/lib/auth/guards";
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
  if (await getCurrentUser()) redirect("/");

  const { locale, t } = await serverDictionary();

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

          <RegisterForm />

          <div className="mt-6 flex justify-center">
            <LanguageToggle className="min-h-9 rounded-full border border-border bg-surface px-3.5 text-xs" />
          </div>
        </div>
      </main>
    </LocaleProvider>
  );
}
