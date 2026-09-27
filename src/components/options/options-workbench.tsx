"use client";

import { useEffect, useState } from "react";
import { SymbolSearch } from "@/components/market/symbol-search";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { OptionExpiration } from "@/types/market";
import { ChainView } from "./chain-view";
import { StrategyFinder } from "./strategy-finder";

type Tab = "chain" | "finder";
type Base = { symbol: string; spot: number; expirations: OptionExpiration[]; error?: string };

/**
 * Options, on a page of their own.
 *
 * One share at a time, chosen at the top, and two clearly separate tools
 * under it: the chain — every contract, laid out the way moomoo does, for
 * looking — and the finder, which searches the chain for trades that fit a
 * goal. It was a pop-up over another page, which is no place for a table
 * of strikes or for results you want to come back to; a page also keeps its
 * address, so the back button and a shared link both work.
 */
export function OptionsWorkbench({
  portfolioSlug,
  initialSymbol,
  initialTab,
  tradeSlug,
}: {
  portfolioSlug: string;
  initialSymbol: string;
  initialTab: Tab;
  tradeSlug?: string | null;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const [typed, setTyped] = useState(initialSymbol);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [base, setBase] = useState<Base | null>(null);

  // The address follows the page, so a link to it opens the same view.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (symbol) url.searchParams.set("symbol", symbol);
    else url.searchParams.delete("symbol");
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }, [symbol, tab]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!symbol) {
        setBase(null);
        return;
      }
      void fetch(`/api/options/chain?portfolio=${encodeURIComponent(portfolioSlug)}&symbol=${encodeURIComponent(symbol)}`)
        .then((response) => response.json())
        .then((raw: Partial<Base>) => {
          if (cancelled) return;
          setBase({ symbol, spot: raw.spot ?? 0, expirations: raw.expirations ?? [], error: raw.error });
        })
        .catch(() => {
          if (!cancelled) setBase({ symbol, spot: 0, expirations: [], error: "offline" });
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [portfolioSlug, symbol]);

  return (
    <div className="space-y-5">
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,24rem)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const value = typed.trim().toUpperCase();
          if (/^[A-Z][A-Z0-9.]{0,9}$/.test(value)) setSymbol(value);
        }}
      >
        <label className="block text-xs text-muted-foreground" htmlFor="options-symbol">
          {say("Options on", "期权标的")}
          <SymbolSearch
            id="options-symbol"
            className="mt-1.5"
            value={typed}
            onChange={(value) => setTyped(value.toUpperCase())}
            onPick={(listing) => setSymbol(listing.symbol)}
            placeholder={say("A share or fund, e.g. NVDA", "股票或基金，例如 NVDA")}
          />
        </label>
        {base && base.spot > 0 && (
          <p className="text-sm sm:pb-3">
            <span className="font-medium">{base.symbol}</span>{" "}
            <span className="tabular">${base.spot.toFixed(2)}</span>
          </p>
        )}
      </form>

      <div className="flex gap-1 border-b border-border" role="tablist">
        {([
          ["chain", say("Option chain", "期权链")],
          ["finder", say("Strategy finder", "策略搜索")],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "-mb-px min-h-10 border-b-2 px-3 text-sm",
              tab === value ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {!symbol ? (
        <p className="text-sm text-muted-foreground">
          {say("Choose a share or fund above to see its options.", "先在上方选择一只股票或基金。")}
        </p>
      ) : !base ? (
        <p className="text-sm text-muted-foreground">{say("Loading…", "加载中…")}</p>
      ) : base.error ? (
        <p className="text-sm text-negative">
          {base.error === "offline" ? say("Could not reach the site.", "连不上网站。") : base.error}
        </p>
      ) : base.expirations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {say(`No options are listed on ${base.symbol}.`, `${base.symbol} 没有上市的期权。`)}
        </p>
      ) : tab === "chain" ? (
        <ChainView
          key={base.symbol}
          portfolioSlug={portfolioSlug}
          symbol={base.symbol}
          spot={base.spot}
          expirations={base.expirations}
          tradeSlug={tradeSlug}
        />
      ) : (
        <StrategyFinder
          key={base.symbol}
          portfolioSlug={portfolioSlug}
          symbol={base.symbol}
          spot={base.spot}
          expirations={base.expirations}
          tradeSlug={tradeSlug}
        />
      )}
    </div>
  );
}
