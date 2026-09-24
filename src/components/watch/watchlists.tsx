"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Help } from "@/components/ui/help";
import { QuoteDetailPanel } from "@/components/market/quote-detail";
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
}: {
  me: string;
  mine: string[];
  everyone: Watcher[];
  popular: { symbol: string; watchers: number }[];
  details: Record<string, QuoteDetail>;
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
          {action}
        </div>
        {expanded && detail && (
          <div className="border-t border-border px-3 py-3">
            <QuoteDetailPanel detail={detail} />
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
              "Your own list of names to keep an eye on, priced the way the broker prices them. Tap a row for everything the broker publishes about it. The Everyone tab shows what other members are watching — only the list, never what anybody owns.",
              "你自己想关注的股票列表，价格与券商一致。点开任意一行可以看到券商提供的全部数据。「大家」标签页显示其他成员在关注什么——只显示关注列表，不会显示任何人的持仓。",
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
            <Input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder={say("Add a ticker, e.g. NVDA", "添加代码，例如 NVDA")}
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <Button type="submit" disabled={busy || !symbol.trim()}>
              <Plus className="size-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only sm:ml-1">{say("Add", "添加")}</span>
            </Button>
          </form>
          {error && <p className="text-sm text-negative">{error}</p>}

          {mine.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {say(
                "Nothing here yet. Add a ticker above, or pick one up from the Everyone tab.",
                "还没有任何股票。在上方添加代码，或者从「大家」里挑一个。",
              )}
            </p>
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
