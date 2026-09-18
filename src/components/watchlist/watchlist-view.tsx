"use client";

import { useState } from "react";
import { Search, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { useT } from "@/lib/i18n/context";
import { cn, signClass } from "@/lib/utils";
import type { WatchlistEntry } from "@/lib/watchlist";

type SearchResult = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
};

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function WatchlistView({
  initial,
  aiEnabled,
}: {
  initial: WatchlistEntry[];
  aiEnabled: boolean;
}) {
  const t = useT();
  const [entries, setEntries] = useState(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    setBusy("search");
    setError(null);
    setResults(null);

    const response = await fetch(
      `/api/market/search?q=${encodeURIComponent(query.trim())}`,
    );
    const data = await response.json().catch(() => ({ results: [] }));
    setResults(data.results ?? []);
    setBusy(null);
  }

  async function add() {
    if (!selected) return;
    if (reason.trim().length < 3) {
      setError(t.watchlist.reasonRequired);
      return;
    }

    setBusy("add");
    setError(null);

    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: selected.symbol,
        name: selected.name,
        reason: reason.trim(),
      }),
    });

    const data = await response.json().catch(() => ({}));
    setBusy(null);

    if (!response.ok) {
      setError(data.error ?? t.common.error);
      return;
    }

    setEntries((current) => [
      { ...data.entry, price: selected.price, changePercent: selected.changePercent },
      ...current.filter((e) => e.symbol !== data.entry.symbol),
    ]);
    setSelected(null);
    setReason("");
    setResults(null);
    setQuery("");
  }

  async function remove(symbol: string) {
    setBusy(symbol);
    await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    });
    setEntries((current) => current.filter((e) => e.symbol !== symbol));
    setBusy(null);
  }

  async function askAi(entry: WatchlistEntry) {
    setBusy(`ai-${entry.symbol}`);
    setError(null);

    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "view",
        symbol: entry.symbol,
        name: entry.name ?? undefined,
        reason: entry.reason,
      }),
    });

    const data = await response.json().catch(() => ({}));
    setBusy(null);

    if (!response.ok) {
      setError(data.error ?? t.common.error);
      return;
    }

    setEntries((current) =>
      current.map((e) =>
        e.symbol === entry.symbol ? { ...e, aiNote: data.text } : e,
      ),
    );
  }

  async function helpWrite() {
    if (reason.trim().length < 3) return;
    setBusy("rewrite");

    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "rewrite", draft: reason.trim() }),
    });

    const data = await response.json().catch(() => ({}));
    setBusy(null);
    if (response.ok && data.text) setReason(data.text);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t.watchlist.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.watchlist.subtitle}</p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5">
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="search">{t.watchlist.search}</Label>
            <Input
              id="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="AAPL"
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </div>
          <Button type="submit" disabled={busy === "search"}>
            <Search className="size-4" aria-hidden="true" />
            {busy === "search" ? t.watchlist.searching : t.watchlist.search}
          </Button>
        </form>

        {results?.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">{t.watchlist.noResults}</p>
        )}

        {results && results.length > 0 && (
          <ul className="mt-4 space-y-2">
            {results.map((result) => (
              <li key={result.symbol}>
                <button
                  type="button"
                  onClick={() => setSelected(result)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                    selected?.symbol === result.symbol
                      ? "border-accent bg-muted"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{result.symbol}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {result.name}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-sm">{usd(result.price)}</p>
                    <p
                      className={cn(
                        "tabular text-xs",
                        signClass(result.changePercent),
                      )}
                    >
                      {result.changePercent >= 0 ? "+" : ""}
                      {result.changePercent.toFixed(2)}%
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="reason">{t.watchlist.reason}</Label>
              <textarea
                id="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={add} disabled={busy === "add"}>
                {t.watchlist.add} — {selected.symbol}
              </Button>
              {aiEnabled && (
                <Button
                  variant="outline"
                  onClick={helpWrite}
                  disabled={busy === "rewrite"}
                >
                  <Sparkles className="size-4" aria-hidden="true" />
                  {busy === "rewrite" ? t.watchlist.aiThinking : t.watchlist.helpWrite}
                </Button>
              )}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-negative">
            {error}
          </p>
        )}
      </section>

      {entries.length === 0 ? (
        <EmptyState title={t.watchlist.empty} description={t.watchlist.emptyHint} />
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.symbol}
              className="rounded-xl border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {entry.symbol}
                    {entry.name && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {entry.name}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.watchlist.addedBy} {entry.addedBy}
                  </p>
                </div>

                {entry.price !== undefined && (
                  <div className="shrink-0 text-right">
                    <p className="tabular text-sm font-medium">{usd(entry.price)}</p>
                    {entry.changePercent !== undefined && (
                      <p
                        className={cn(
                          "tabular text-xs",
                          signClass(entry.changePercent),
                        )}
                      >
                        {entry.changePercent >= 0 ? "+" : ""}
                        {entry.changePercent.toFixed(2)}%
                      </p>
                    )}
                  </div>
                )}
              </div>

              <p className="mt-3 text-sm">{entry.reason}</p>

              {entry.aiNote && (
                <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t.watchlist.aiTitle}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm">{entry.aiNote}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t.watchlist.aiDisclaimer}
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {aiEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => askAi(entry)}
                    disabled={busy === `ai-${entry.symbol}`}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    {busy === `ai-${entry.symbol}`
                      ? t.watchlist.aiThinking
                      : t.watchlist.askAi}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(entry.symbol)}
                  disabled={busy === entry.symbol}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t.watchlist.remove}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
