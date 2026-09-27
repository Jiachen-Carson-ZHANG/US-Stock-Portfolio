"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SymbolSearch } from "@/components/market/symbol-search";
import { useCurrentSlug, type NavPortfolio } from "@/components/layout/nav";
import { useLocale } from "@/lib/i18n/context";

const TICKER = /^[A-Z][A-Z0-9.\-]{0,23}$/;

/**
 * Search, from every page.
 *
 * Until now a symbol could only be looked up on the trade ticket or the
 * watchlist, so anybody new had no obvious place to start. This is the box at
 * the top of every screen, the way a broker's app has one: type a ticker or a
 * company's name, pick it, and its page opens — in the account you are
 * looking at, so your own position shows beside it if you hold it.
 */
export function GlobalSearch({
  portfolios,
  defaultSlug,
  variant,
}: {
  portfolios: NavPortfolio[];
  defaultSlug: string;
  /** "bar" for the desktop toolbar; "icon" for the phone header. */
  variant: "bar" | "icon";
}) {
  const zh = useLocale() === "zh";
  const router = useRouter();
  const slug = useCurrentSlug(portfolios, defaultSlug);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);

  function go(symbol: string) {
    setValue("");
    setOpen(false);
    const path = `/holdings/${encodeURIComponent(symbol)}`;
    router.push(slug ? `/${slug}${path}` : path);
  }

  const form = (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const typed = value.trim().toUpperCase();
        if (TICKER.test(typed)) go(typed);
      }}
    >
      <SymbolSearch
        id={`global-search-${variant}`}
        value={value}
        onChange={setValue}
        onPick={(listing) => go(listing.symbol)}
        placeholder={zh ? "搜索股票、基金或公司名" : "Search stocks, funds or companies"}
        autoFocus={variant === "icon"}
        leading={<Search className="size-4" aria-hidden="true" />}
        inputClassName={variant === "bar" ? "shadow-sm" : undefined}
      />
    </form>
  );

  if (variant === "bar") return <div className="w-full">{form}</div>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={zh ? "搜索" : "Search"}
        className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
      >
        <Search className="size-5" aria-hidden="true" />
      </button>
      {open && (
        <div className="fixed inset-x-0 top-0 z-40 flex items-start gap-2 border-b border-border bg-surface p-3 shadow-lg">
          <div className="min-w-0 flex-1">{form}</div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={zh ? "关闭" : "Close"}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
