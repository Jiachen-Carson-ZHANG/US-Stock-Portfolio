"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { LayoutGrid, LineChart, Settings, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/session";

const ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid, ownerOnly: false },
  { href: "/holdings", label: "Holdings", icon: Table2, ownerOnly: false },
  { href: "/performance", label: "Performance", icon: LineChart, ownerOnly: false },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

function useVisibleItems(role: UserRole) {
  return ITEMS.filter((item) => !item.ownerOnly || role === "owner");
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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

  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
      <div className="px-5 py-5">
        <p className="text-sm font-semibold tracking-tight">Family Portfolio</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{displayName}</p>
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
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {canSignOut && (
        <div className="px-3 pb-4">
          <SignOutButton />
        </div>
      )}
    </aside>
  );
}

export function BottomNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = useVisibleItems(role);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="flex">
        {items.map((item) => (
          <li key={item.href} className="flex-1">
            <Link
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px]",
                isActive(pathname, item.href)
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();

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
      Sign out
    </button>
  );
}
