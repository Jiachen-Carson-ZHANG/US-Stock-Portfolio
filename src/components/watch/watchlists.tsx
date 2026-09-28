"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Help } from "@/components/ui/help";
import { SymbolSearch } from "@/components/market/symbol-search";
import { MarketPanel } from "@/components/market/market-panel";
import { useLocale } from "@/lib/i18n/context";
import { cn, signClass } from "@/lib/utils";
import type { QuoteDetail } from "@/lib/market/detail";
import type { Watcher } from "@/lib/watch";

type Tab = "mine" | "everyone";

function price(value: number | undefined): string {
  return value === undefined ? "—" : `$${value.toFixed(2)}`;
}

/**
 * Two tabs: your list, and everybody's.
 *
 * A row is the symbol, its name, the price and the day's move — the four
 * things you look at a watchlist for. Tapping it opens everything else the
 * broker publishes, rather than cramming twenty numbers into every row.
 */
export function Watchlists({
  me,
  mine,
  everyone,
  popular,
  details,
  stockBase,
}: {
  me: string;
  mine: string[];
  everyone: Watcher[];
  popular: { symbol: string; watchers: number }[];
  details: Record<string, QuoteDetail>;
  /** Where a symbol's page lives, in the account being looked at. */
  stockBase: string;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("mine");
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const watching = new Set(mine);

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function add(target: string) {
    const value = target.trim().toUpperCase();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? say("Could not add that.", "无法添加。"));
        return;
      }
      setSymbol("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    await fetch("/api/watch", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: target }),
    });
    router.refresh();
  }

  function Row({ value, keyPrefix, action }: { value: string; keyPrefix: string; action?: React.ReactNode }) {
    const detail = details[value];
    const key = `${keyPrefix}:${value}`;
    const expanded = open.has(key);
    // moomoo's own simplified-Chinese name, when there is one.
    const name = zh ? (detail?.nameZh ?? detail?.name) : detail?.name;

    return (
      <li className="rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={expanded}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-tight">{value}</span>
              {name && name !== value && (
                <span className="block truncate text-[11px] leading-tight text-muted-foreground">{name}</span>
              )}
            </span>
            <span className="shrink-0 text-right">
              <span className="tabular block text-sm font-medium leading-tight">{price(detail?.price)}</span>
              <span className={cn("tabular block text-[11px] leading-tight", signClass(detail?.changePercent ?? 0))}>
                {detail?.changePercent === undefined
                  ? "—"
                  : `${detail.changePercent >= 0 ? "+" : ""}${detail.changePercent.toFixed(2)}%`}
              </span>
            </span>
          </button>
          <Link
            href={`${stockBase}/${encodeURIComponent(value)}`}
            aria-label={say(`Open ${value}`, `打开 ${value}`)}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
          {action}
        </div>
        {/* The same grouped cards as the stock's own page: a flat grid of
            twenty figures in equal type was hard to find anything in. */}
        {expanded && detail && (
          <div className="space-y-3 border-t border-border bg-background/60 px-3 py-3">
            <MarketPanel detail={detail} />
            <Button asChild variant="outline" size="sm">
              <Link href={`${stockBase}/${encodeURIComponent(value)}`}>
                {say("Open its page for the chart and more", "打开它的详情页，看走势和更多")}
              </Link>
            </Button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
          {say("Watchlist", "自选")}
          <Help title={say("What this is", "这是什么")}>
            {say(
              "Your own list of names to keep an eye on, priced the way the broker prices them. Tap a row for everything the broker publishes about it. The Everyone tab shows what other members are watching, which is only the list and never what anybody owns.",
              "你自己想关注的股票列表，价格与券商一致。点开任意一行可以看到券商提供的全部数据。「大家」标签页显示其他成员在关注什么，只显示关注列表，不会显示任何人的持仓。",
            )}
          </Help>
        </h1>
      </header>

      <div className="flex gap-1" role="tablist">
        {([["mine", say("Mine", "我的")], ["everyone", say("Everyone", "大家")]] as const).map(
          ([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "min-h-9 rounded-lg border px-4 text-sm transition-colors",
                tab === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {tab === "mine" ? (
        <section className="space-y-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void add(symbol);
            }}
            className="flex gap-2"
          >
            {/* By name as well as ticker: "micron" finds MU. */}
            <SymbolSearch
              id="watch-add"
              className="flex-1"
              value={symbol}
              onChange={(value) => setSymbol(value.toUpperCase())}
              placeholder={say("Add a ticker or company", "添加代码或公司名")}
            />
            <Button type="submit" disabled={busy || !symbol.trim()}>
              <Plus className="size-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-1">{say("Add", "添加")}</span>
            </Button>
          </form>
          {error && <p className="text-sm text-negative">{error}</p>}

          {mine.length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              <p>
                {say(
                  "Nothing here yet. Add a ticker or company above, pick one up from the Everyone tab, or start with a few names most people know.",
                  "还没有任何股票。可以在上方添加代码或公司名，从「大家」里挑一个，或者先从几只大家熟悉的开始。",
                )}
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await fetch("/api/watch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ starter: true }),
                  }).catch(() => null);
                  setBusy(false);
                  router.refresh();
                }}
              >
                {say("Start with popular picks", "从热门股票开始")}
              </Button>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {mine.map((value) => (
                <Row
                  key={value}
                  value={value}
                  keyPrefix="mine"
                  action={
                    <button
                      type="button"
                      onClick={() => void remove(value)}
                      aria-label={say(`Remove ${value}`, `移除 ${value}`)}
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="space-y-5">
          {popular.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {say("Watched by several people", "多人关注")}
              </h2>
              <ul className="space-y-1.5">
                {popular.map((entry) => (
                  <Row
                    key={entry.symbol}
                    value={entry.symbol}
                    keyPrefix="popular"
                    action={
                      <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                        {entry.watchers} {say("watching", "人关注")}
                      </span>
                    }
                  />
                ))}
              </ul>
            </div>
          )}

          {everyone.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {say("Nobody is watching anything yet.", "还没有人关注任何股票。")}
            </p>
          ) : (
            everyone.map((person) => (
              <div key={person.userId}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {person.userId === me ? say("You", "你") : person.displayName}
                </h2>
                <ul className="space-y-1.5">
                  {person.symbols.map((value) => (
                    <Row
                      key={value}
                      value={value}
                      keyPrefix={person.userId}
                      action={
                        !watching.has(value) && (
                          <button
                            type="button"
                            onClick={() => void add(value)}
                            aria-label={say(`Watch ${value} too`, `也关注 ${value}`)}
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </button>
                        )
                      }
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}
