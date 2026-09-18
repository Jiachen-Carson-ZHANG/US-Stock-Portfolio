import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/guards";
import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import { LoginForm } from "@/components/layout/login-form";
import { LanguageToggle } from "@/components/layout/nav";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const { locale, t } = await serverDictionary();

  return (
    <LocaleProvider locale={locale}>
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-xl font-semibold tracking-tight">{t.login.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t.login.subtitle}</p>
          </div>

          <LoginForm />

          <div className="mt-4 flex justify-center">
            <LanguageToggle />
          </div>
        </div>
      </main>
    </LocaleProvider>
  );
}
