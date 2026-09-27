"use client";

import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/field";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type Listing = { symbol: string; name: string; etf: boolean };

/**
 * A symbol field that also answers to a company name.
 *
 * Type "micron" and Micron is offered; type 英伟达 and NVIDIA is, if the site
 * has priced it before. A ticker typed in full still works without picking
 * anything — the list is a help, never a gate — which matters for option
 * contracts, whose long codes are not in any directory.
 *
 * Keyboard: up and down move through the list, Enter picks, Escape closes.
 */
export function SymbolSearch({
  id,
  value,
  onChange,
  onPick,
  placeholder = "NVDA",
  className,
  autoFocus = false,
}: {
  id: string;
  value: string;
  /** Called as it is typed, and with the ticker when one is picked. */
  onChange: (value: string) => void;
  /** Called when a suggestion is chosen, for fields that act on a choice. */
  onPick?: (listing: Listing) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const zh = useLocale() === "zh";
  const listId = useId();
  const [results, setResults] = useState<Listing[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // The ticker just picked, so choosing one does not immediately search for
  // it again and reopen the list over the field.
  const [picked, setPicked] = useState<string | null>(null);
  // The query the current results answer. With nothing found the list used
  // to simply not open, and "DBS" looked like a search that never ran.
  const [answered, setAnswered] = useState<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (query.length === 0 || query === picked) {
        setResults([]);
        setAnswered(null);
        return;
      }
      void fetch(`/api/market/search?q=${encodeURIComponent(query)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { results?: Listing[] } | null) => {
          if (cancelled) return;
          setResults(body?.results ?? []);
          // A failed search is not "nothing found".
          setAnswered(body ? query : null);
          setActive(-1);
        })
        .catch(() => {});
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, picked]);

  function pick(listing: Listing) {
    setPicked(listing.symbol);
    onChange(listing.symbol);
    onPick?.(listing);
    setResults([]);
    setOpen(false);
  }

  const showing = open && results.length > 0;
  const settled = open && answered !== null && answered.length >= 2 && answered === value.trim();
  const nothing = settled && results.length === 0;
  // A short query that is no ticker here but turns up in fund names: "DBS"
  // finds the WealthTrust DBS ETF, which is not DBS Group. Said under the list,
  // so the one match is not taken for the bank.
  const notATicker =
    settled &&
    results.length > 0 &&
    /^[A-Za-z0-9]{2,4}$/.test(answered) &&
    !results.some((listing) => listing.symbol === answered.toUpperCase());

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          setPicked(null);
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Late enough that a tap on an option lands before the list goes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (!showing) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(results.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(-1, index - 1));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            pick(results[active]);
          } else if (event.key === "Escape") {
            // Only the list closes. Inside a pop-up, letting Escape through
            // closed the whole pop-up along with it.
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {(showing || nothing) && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {showing && (
            <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
              {results.map((listing, index) => (
                <li
                  key={listing.symbol}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // mousedown, not click: click comes after the field's blur,
                  // which would already have closed the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(listing);
                  }}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm",
                    index === active ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <span className="w-16 shrink-0 font-medium">{listing.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{listing.name}</span>
                  {listing.etf && (
                    <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
                      {zh ? "基金" : "ETF"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(nothing || notATicker) && (
            <p role="status" className={cn("px-3 py-2.5 text-xs text-muted-foreground", notATicker && "border-t border-border")}>
              {nothing
                ? zh
                  ? `找不到“${answered}”。目前只收录在美国上市的股票和基金，只在新加坡、香港等市场上市的暂不支持。`
                  : `Can't find “${answered}”. Only shares and funds listed in the US are covered so far; ones listed only in Singapore, Hong Kong or elsewhere aren't yet.`
                : zh
                  ? `美国市场没有代码为“${answered?.toUpperCase()}”的股票，以上结果只是名称里含有它。只在新加坡、香港等市场上市的股票暂不支持。`
                  : `No US ticker “${answered?.toUpperCase()}” — the results above only have it in their names. Shares listed only in Singapore, Hong Kong or elsewhere aren't covered yet.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
