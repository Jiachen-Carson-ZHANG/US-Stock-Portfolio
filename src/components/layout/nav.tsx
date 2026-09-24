"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  Library,
  Trophy,
  LineChart,
  UserRound,
  Receipt,
  Settings,
  Star,
  Table2,
  MessagesSquare,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/brand-mark";
import type { UserRole } from "@/lib/auth/session";
import { useLocale, useSetLocale, useT } from "@/lib/i18n/context";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * `scoped` items live under a portfolio and take its slug as the first path
 * segment; the rest are the same page whichever portfolio you are looking at.
 */
const ITEMS = [
  { href: "", key: "overview", icon: LayoutGrid, ownerOnly: false, scoped: true },
  { href: "/holdings", key: "holdings", icon: Table2, ownerOnly: false, scoped: true },
  { href: "/performance", key: "performance", icon: LineChart, ownerOnly: false, scoped: true },
  { href: "/transactions", key: "transactions", icon: Receipt, ownerOnly: false, scoped: true },
  { href: "/watchlist", key: "watchlist", icon: Star, ownerOnly: false, scoped: false },
  { href: "/portfolios", key: "portfolios", icon: Library, ownerOnly: false, scoped: false },
  { href: "/arena", key: "arena", icon: Trophy, ownerOnly: false, scoped: false },
  { href: "/playground", key: "playground", icon: MessagesSquare, ownerOnly: false, scoped: false },
  { href: "/account", key: "account", icon: UserRound, ownerOnly: false, scoped: false },
  { href: "/settings", key: "settings", icon: Settings, ownerOnly: true, scoped: false },
] as const;

export type NavPortfolio = {
  slug: string;
  displayName: string;
  kind: "broker" | "mock";
};

function useVisibleItems(role: UserRole) {
  return ITEMS.filter((item) => !item.ownerOnly || role === "owner");
}

/**
 * Which portfolio the page is showing, read from the address rather than
 * passed down: the nav lives in a layout above the [portfolio] segment, so
 * it never receives the parameter.
 */
function useCurrentSlug(portfolios: NavPortfolio[], fallback: string): string {
  const pathname = usePathname();
  const first = pathname.split("/")[1] ?? "";
  return portfolios.some((p) => p.slug === first) ? first : fallback;
}

function hrefFor(item: (typeof ITEMS)[number], slug: string): string {
  return item.scoped ? `/${slug}${item.href}` : item.href;
}

function label(t: Dictionary, key: (typeof ITEMS)[number]["key"]): string {
  return t.nav[key];
}

/**
 * Exact match for a portfolio's root, prefix match otherwise.
 *
 * The overview's address is the bare "/carson", which prefix-matches
 * "/carson/holdings" too — it would sit permanently highlighted without
 * this distinction.
 */
function isActive(pathname: string, href: string, exact = false) {
  if (exact || href === "" || /^\/[^/]+$/.test(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Moves between the portfolios you can see, keeping the page you are on.
 *
 * Only rendered when there is more than one, so a family with a single
 * account never sees a control that does nothing.
 */
export function PortfolioSwitcher({
  portfolios,
  current,
  pathname,
  className,
}: {
  portfolios: NavPortfolio[];
  current: string;
  pathname: string;
  className?: string;
}) {
  const router = useRouter();
  const suffix = pathname.startsWith(`/${current}`)
    ? pathname.slice(`/${current}`.length)
    : "";

  return (
    <label className="block">
      <span className="sr-only">Portfolio</span>
      <select
        value={current}
        onChange={(event) => router.push(`/${event.target.value}${suffix}`)}
        className={cn(
          "min-h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground",
          className,
        )}
      >
        {portfolios.map((portfolio) => (
          <option key={portfolio.slug} value={portfolio.slug}>
            {portfolio.displayName}
            {portfolio.kind === "mock" ? " · mock" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * English / 中文, as a pair.
 *
 * It used to be one button labelled with the language you were not using —
 * "中文" while reading English. That is the conventional pattern and it was
 * missed entirely: a lone word beside a small icon does not read as a
 * control. Showing both, with the current one marked, is unambiguous in
 * either language and needs no icon to explain it.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const setLocale = useSetLocale();

  const options = [
    { value: "en" as const, label: "EN" },
    { value: "zh" as const, label: "中文" },
  ];

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        "inline-flex items-center rounded-lg border border-border p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setLocale(option.value)}
          aria-pressed={locale === option.value}
          className={cn(
            "min-h-8 rounded-md px-2.5 text-xs transition-colors",
            locale === option.value
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Sidebar({
  role,
  displayName,
  canSignOut,
  portfolios,
  defaultSlug,
}: {
  role: UserRole;
  displayName: string;
  canSignOut: boolean;
  portfolios: NavPortfolio[];
  defaultSlug: string;
}) {
  const pathname = usePathname();
  const items = useVisibleItems(role);
  const t = useT();
  const slug = useCurrentSlug(portfolios, defaultSlug);

  return (
    // Sticky and full height. It used to scroll away with the page, so on a
    // long holdings table the navigation was somewhere above the top of the
    // window and getting anywhere meant scrolling back up first.
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <BrandMark className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">{t.appName}</p>
          <p className="truncate text-xs text-muted-foreground">{displayName}</p>
        </div>
      </div>

      {portfolios.length > 1 && (
        <div className="px-3 pb-3">
          <PortfolioSwitcher
            portfolios={portfolios}
            current={slug}
            pathname={pathname}
          />
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={hrefFor(item, slug)}
                aria-current={
                  isActive(pathname, hrefFor(item, slug)) ? "page" : undefined
                }
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive(pathname, hrefFor(item, slug))
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {label(t, item.key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Language moved to the toolbar at the top of the page; keeping a
          second copy here would just mean two places to look. Sign out stays
          here, pinned to the bottom, which is where every other application
          puts it. */}
      <div className="mt-auto border-t border-border px-3 py-3">
        {canSignOut && <SignOutButton />}
      </div>
    </aside>
  );
}

/**
 * Changing account on a phone.
 *
 * The switcher lived only in the sidebar, which a phone does not have — so on
 * a phone there was no way to move between accounts at all, short of typing
 * an address. This is the same control, in the one place a phone has room
 * for it.
 */
export function MobilePortfolioSwitcher({
  portfolios,
  defaultSlug,
}: {
  portfolios: NavPortfolio[];
  defaultSlug: string;
}) {
  const pathname = usePathname();
  const slug = useCurrentSlug(portfolios, defaultSlug);

  if (portfolios.length < 2) return null;

  return (
    <PortfolioSwitcher
      portfolios={portfolios}
      current={slug}
      pathname={pathname}
      className="max-w-[9rem] truncate"
    />
  );
}

export function BottomNav({
  role,
  portfolios,
  defaultSlug,
}: {
  role: UserRole;
  portfolios: NavPortfolio[];
  defaultSlug: string;
}) {
  const pathname = usePathname();
  const items = useVisibleItems(role);
  const t = useT();
  const slug = useCurrentSlug(portfolios, defaultSlug);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="flex overflow-x-auto">
        {items.map((item) => (
          <li key={item.key} className="min-w-16 flex-1">
            <Link
              href={hrefFor(item, slug)}
              aria-current={
                isActive(pathname, hrefFor(item, slug)) ? "page" : undefined
              }
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-[10px]",
                isActive(pathname, hrefFor(item, slug))
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="w-full truncate text-center">
                {label(t, item.key)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SignOutButton({ className, phoneIcon = false }: { className?: string; phoneIcon?: boolean }) {
  const router = useRouter();
  const t = useT();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      aria-label={t.nav.signOut}
      title={t.nav.signOut}
      className={cn(
        "w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {phoneIcon && <LogOut aria-hidden="true" className="size-4 sm:hidden" />}
      <span className={phoneIcon ? "hidden sm:inline" : undefined}>{t.nav.signOut}</span>
    </button>
  );
}
