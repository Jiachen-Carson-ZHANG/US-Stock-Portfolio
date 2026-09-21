import { isOpenAccess, requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { defaultFor, visibleTo } from "@/lib/portfolios";
import { unreadCount } from "@/lib/notifications";
import { NotificationBell } from "@/components/layout/notifications";
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

  // The nav needs the list to build links and to decide whether a switcher is
  // worth showing. It is the same access rule as everywhere else, so a
  // portfolio you cannot open never appears in it.
  const db = await getDb();
  const portfolios = (await visibleTo(db, user)).map((portfolio) => ({
    slug: portfolio.slug,
    displayName: portfolio.displayName,
    kind: portfolio.kind,
  }));
  const defaultSlug = (await defaultFor(db, user))?.slug ?? "";
  const unread = isOpenAccess() ? 0 : await unreadCount(db, user.id);

  return (
    <LocaleProvider locale={locale}>
      <div className="flex min-h-dvh">
        <Sidebar
          role={user.role}
          displayName={user.displayName}
          canSignOut={canSignOut}
          portfolios={portfolios}
          defaultSlug={defaultSlug}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2 md:hidden">
            <p className="truncate text-sm font-semibold tracking-tight">
              {t.appName}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <LanguageToggle />
              {canSignOut && <NotificationBell initialUnread={unread} />}
              {canSignOut && <SignOutButton className="w-auto px-2 py-1" />}
            </div>
          </header>

          {/* The desktop toolbar. The language switch used to sit alone at
              the bottom of the sidebar, below the navigation, where nobody
              looked for it. Top right is where people look. */}
          <div className="hidden items-center justify-end gap-1 px-8 pt-4 md:flex">
            <LanguageToggle />
            {canSignOut && <NotificationBell initialUnread={unread} />}
          </div>

          <main className="flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-4 md:pb-10">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>

        <BottomNav
          role={user.role}
          portfolios={portfolios}
          defaultSlug={defaultSlug}
        />
      </div>
    </LocaleProvider>
  );
}
