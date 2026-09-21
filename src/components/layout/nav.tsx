"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  Trophy,
  LineChart,
  UserRound,
  Languages,
  Receipt,
  Settings,
  Star,
  Table2,
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
  { href: "/arena", key: "arena", icon: Trophy, ownerOnly: false, scoped: false },
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
function PortfolioSwitcher({
  portfolios,
  current,
  pathname,
}: {
  portfolios: NavPortfolio[];
  current: string;
  pathname: string;
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
        className="min-h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground"
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

export function LanguageToggle({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "en" ? "zh" : "en")}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Languages className="size-4" aria-hidden="true" />
      {t.nav.language}
    </button>
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
    <aside className="hidden w-56 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
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

      <nav className="flex-1 px-3">
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

      <div className="space-y-0.5 px-3 pb-4">
        <LanguageToggle className="w-full justify-start" />
        {canSignOut && <SignOutButton />}
      </div>
    </aside>
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

export function SignOutButton({ className }: { className?: string }) {
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
      className={cn(
        "w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {t.nav.signOut}
    </button>
  );
}
