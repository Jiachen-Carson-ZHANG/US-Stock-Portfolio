import { isOpenAccess, requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { visibleTo } from "@/lib/portfolios";
import { lastViewedOr } from "@/lib/portfolios/last-viewed";
import { unreadCount } from "@/lib/notifications";
import { NotificationBell } from "@/components/layout/notifications";
import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import {
  BottomNav,
  LanguageToggle,
  MobilePortfolioSwitcher,
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
  // What the navigation assumes when the address carries no portfolio — the
  // last one this person opened, so leaving for the playground and coming
  // back returns them to where they were rather than to a rule's idea of
  // where they belong.
  const defaultSlug = (await lastViewedOr(db, user))?.slug ?? "";
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
          {/* The phone header. The account name replaces the app name, because
              on a phone this is the only place to change account and knowing
              which one you are looking at matters more than being told what
              the site is called. */}
          <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 md:hidden">
            <MobilePortfolioSwitcher
              portfolios={portfolios}
              defaultSlug={defaultSlug}
            />
            <p className="truncate text-sm font-semibold tracking-tight md:hidden">
              {portfolios.length < 2 ? t.appName : ""}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <LanguageToggle />
              {canSignOut && <NotificationBell initialUnread={unread} />}
              {canSignOut && <SignOutButton phoneIcon className="flex min-h-10 w-auto items-center justify-center px-2 py-1 sm:min-h-0" />}
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
