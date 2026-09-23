"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";
import { cn, signClass } from "@/lib/utils";
import type { Horizon, Post } from "@/lib/playground";

type Prices = Record<string, { price: number; changePercent: number }>;

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The playground.
 *
 * What replaced the family room: somewhere to say "I like this one and here
 * is why", and for somebody else to say why that is wrong. A post can name a
 * ticker, which then carries its live price, and can be filed under the two
 * questions that were actually asked — what is worth watching over the next
 * few months, and what over the next year.
 *
 * Nothing here touches anybody's holdings. Naming a stock is not the same as
 * showing what you own, and this room deliberately stays on the first side of
 * that line.
 */
export function Playground({
  threads,
  prices,
  me,
}: {
  threads: Post[];
  prices: Prices;
  me: { id: string; isAdministrator: boolean };
}) {
  const t = useT();
  const router = useRouter();

  const [body, setBody] = useState("");
  const [symbol, setSymbol] = useState("");
  const [horizon, setHorizon] = useState<Horizon | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Horizon | "">("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const HORIZON_LABEL: Record<Horizon, string> = {
    "three-months": t.playground.horizonThreeMonths,
    "one-year": t.playground.horizonOneYear,
  };

  async function send(payload: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Could not post that.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    const ok = await send({ body, symbol, horizon });
    if (!ok) return;
    setBody("");
    setSymbol("");
    setHorizon("");
  }

  async function reply(parentId: string) {
    const ok = await send({ body: replyBody, parentId });
    if (!ok) return;
    setReplyBody("");
    setReplyingTo(null);
  }

  async function remove(id: string) {
    await fetch("/api/playground", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  const shown = filter ? threads.filter((thread) => thread.horizon === filter) : threads;

  function Ticker({ value }: { value: string }) {
    const quote = prices[value];
    return (
      <span className="inline-flex items-baseline gap-1.5 rounded-md bg-muted px-1.5 py-0.5">
        <span className="text-xs font-medium">{value}</span>
        {quote && (
          <>
            <span className="tabular text-xs">{quote.price.toFixed(2)}</span>
            <span className={cn("tabular text-[11px]", signClass(quote.changePercent))}>
              {quote.changePercent >= 0 ? "+" : ""}
              {quote.changePercent.toFixed(2)}%
            </span>
          </>
        )}
      </span>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t.playground.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.playground.subtitle}</p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">{t.playground.newTopic}</h2>

        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pg-body" className="text-xs text-muted-foreground">
              {t.playground.body}
            </Label>
            <textarea
              id="pg-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              placeholder={t.playground.bodyPlaceholder}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pg-symbol" className="text-xs text-muted-foreground">
                {t.playground.symbol}
              </Label>
              <Input
                id="pg-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                placeholder="NVDA"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-horizon" className="text-xs text-muted-foreground">
                {t.playground.horizon}
              </Label>
              <select
                id="pg-horizon"
                value={horizon}
                onChange={(event) => setHorizon(event.target.value as Horizon | "")}
                className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
              >
                <option value="">{t.playground.horizonNone}</option>
                <option value="three-months">{t.playground.horizonThreeMonths}</option>
                <option value="one-year">{t.playground.horizonOneYear}</option>
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-negative">{error}</p>}

          <Button onClick={() => void post()} disabled={busy || !body.trim()}>
            {busy ? t.playground.posting : t.playground.post}
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap gap-1.5">
        {([["", t.playground.filterAll], ["three-months", t.playground.horizonThreeMonths], ["one-year", t.playground.horizonOneYear]] as const).map(
          ([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setFilter(value as Horizon | "")}
              aria-pressed={filter === value}
              className={cn(
                "min-h-8 rounded-lg border px-3 text-xs transition-colors",
                filter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          {t.playground.empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((thread) => (
            <li key={thread.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{thread.author}</span>
                {thread.symbol && <Ticker value={thread.symbol} />}
                {thread.horizon && (
                  <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {HORIZON_LABEL[thread.horizon]}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {ago(thread.createdAt)}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm">{thread.body}</p>

              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setReplyingTo((current) => (current === thread.id ? null : thread.id))
                  }
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <MessageSquare className="size-3.5" aria-hidden="true" />
                  {t.playground.reply}
                  {thread.replies.length > 0 && ` · ${thread.replies.length}`}
                </button>
                {(thread.userId === me.id || me.isAdministrator) && (
                  <button
                    type="button"
                    onClick={() => void remove(thread.id)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-negative"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    {t.playground.remove}
                  </button>
                )}
              </div>

              {thread.replies.length > 0 && (
                <ul className="mt-3 space-y-2 border-l border-border pl-3">
                  {thread.replies.map((item) => (
                    <li key={item.id}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{item.author}</span>
                        <span className="text-xs text-muted-foreground">
                          {ago(item.createdAt)}
                        </span>
                        {(item.userId === me.id || me.isAdministrator) && (
                          <button
                            type="button"
                            onClick={() => void remove(item.id)}
                            className="ml-auto text-xs text-muted-foreground hover:text-negative"
                          >
                            {t.playground.remove}
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm">{item.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              {replyingTo === thread.id && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={replyBody}
                    onChange={(event) => setReplyBody(event.target.value)}
                    rows={2}
                    placeholder={t.playground.replyPlaceholder}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base"
                  />
                  <Button
                    size="sm"
                    onClick={() => void reply(thread.id)}
                    disabled={busy || !replyBody.trim()}
                  >
                    {busy ? t.playground.posting : t.playground.reply}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
