"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  LineChart,
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

const ITEMS = [
  { href: "/dashboard", key: "overview", icon: LayoutGrid, ownerOnly: false },
  { href: "/holdings", key: "holdings", icon: Table2, ownerOnly: false },
  { href: "/performance", key: "performance", icon: LineChart, ownerOnly: false },
  { href: "/transactions", key: "transactions", icon: Receipt, ownerOnly: false },
  { href: "/watchlist", key: "watchlist", icon: Star, ownerOnly: false },
  { href: "/settings", key: "settings", icon: Settings, ownerOnly: true },
] as const;

function useVisibleItems(role: UserRole) {
  return ITEMS.filter((item) => !item.ownerOnly || role === "owner");
}

function label(t: Dictionary, key: (typeof ITEMS)[number]["key"]): string {
  return t.nav[key];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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
}: {
  role: UserRole;
  displayName: string;
  canSignOut: boolean;
}) {
  const pathname = usePathname();
  const items = useVisibleItems(role);
  const t = useT();

  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <BrandMark className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">{t.appName}</p>
          <p className="truncate text-xs text-muted-foreground">{displayName}</p>
        </div>
      </div>

      <nav className="flex-1 px-3">
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive(pathname, item.href)
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

export function BottomNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = useVisibleItems(role);
  const t = useT();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="flex">
        {items.map((item) => (
          <li key={item.href} className="min-w-0 flex-1">
            <Link
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-[10px]",
                isActive(pathname, item.href)
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
