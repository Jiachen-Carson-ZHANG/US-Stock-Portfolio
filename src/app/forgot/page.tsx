import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import { LanguageToggle } from "@/components/layout/nav";
import { BrandMark } from "@/components/layout/brand-mark";
import { ForgotForm } from "@/components/layout/forgot-form";

export default async function ForgotPage() {
  const { locale, t } = await serverDictionary();

  return (
    <LocaleProvider locale={locale}>
      <main className="auth-field flex min-h-dvh flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[22rem]">
          <div className="mb-9 flex flex-col items-center text-center">
            <BrandMark className="size-12" />
            <h1 className="mt-5 text-[1.375rem] font-semibold tracking-tight">
              {t.forgot.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t.forgot.subtitle}</p>
          </div>

          <ForgotForm />

          <div className="mt-6 flex justify-center">
            <LanguageToggle className="min-h-9 rounded-full border border-border bg-surface px-3.5 text-xs" />
          </div>
        </div>
      </main>
    </LocaleProvider>
  );
}
