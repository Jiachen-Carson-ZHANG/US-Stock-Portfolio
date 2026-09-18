import { isOpenAccess, requireUser } from "@/lib/auth/guards";
import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import {
  BottomNav,
  LanguageToggle,
  Sidebar,
  SignOutButton,
} from "@/components/layout/nav";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const { locale, t } = await serverDictionary();
  const canSignOut = !isOpenAccess();

  return (
    <LocaleProvider locale={locale}>
      <div className="flex min-h-dvh">
        <Sidebar
          role={user.role}
          displayName={user.displayName}
          canSignOut={canSignOut}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 md:hidden">
            <p className="truncate text-sm font-semibold tracking-tight">
              {t.appName}
            </p>
            <div className="flex shrink-0 items-center">
              <LanguageToggle className="px-2" />
              {canSignOut && <SignOutButton className="w-auto px-2 py-1" />}
            </div>
          </header>

          <main className="flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-10">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>

        <BottomNav role={user.role} />
      </div>
    </LocaleProvider>
  );
}
