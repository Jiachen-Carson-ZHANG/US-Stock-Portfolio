"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPen } from "lucide-react";
import { useHydrated } from "@/lib/local-time";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type Note = { date: string; body: string; updatedAt: string };

/** Today in the reader's own calendar, not the server's or New York's. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function longDate(date: string, zh: boolean): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(zh ? "zh-CN" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A journal on one share, a page a day.
 *
 * Opening it gives a blank page with today's date. Everything written before
 * is listed beside it, newest first, so what you thought and why can be read
 * back later against what the price actually did. Saved as you type, and
 * private to you: it belongs to the person, not to any account.
 */
export function StockNotes({ symbol }: { symbol: string }) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const hydrated = useHydrated();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = hydrated ? localToday() : null;
  const open = date ?? today;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/notes?symbol=${encodeURIComponent(symbol)}`)
      .then((response) => (response.ok ? response.json() : { notes: [] }))
      .then((body: { notes?: Note[] }) => {
        if (!cancelled) setNotes(body.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // The page being read: a past entry, or today's (blank until written).
  const shown = notes?.find((note) => note.date === open)?.body ?? "";
  const [editing, setEditing] = useState<string | null>(null);
  if (open !== editing && notes !== null && open !== null) {
    setEditing(open);
    setDraft(shown);
  }

  function write(text: string) {
    setDraft(text);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    const day = open;
    timer.current = setTimeout(() => {
      if (!day) return;
      void fetch("/api/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, date: day, body: text }),
      })
        .then((response) => {
          if (!response.ok) throw new Error("failed");
          setState("saved");
          setNotes((before) => {
            const rest = (before ?? []).filter((note) => note.date !== day);
            if (text.trim().length === 0) return rest;
            return [{ date: day, body: text, updatedAt: new Date().toISOString() }, ...rest].sort((a, b) =>
              b.date.localeCompare(a.date),
            );
          });
        })
        .catch(() => setState("failed"));
    }, 700);
  }

  const past = (notes ?? []).filter((note) => note.date !== today);

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <NotebookPen className="size-4 text-muted-foreground" aria-hidden="true" />
          {say(`Your notes on ${symbol}`, `你对 ${symbol} 的笔记`)}
        </h2>
        <p className="text-xs text-muted-foreground" role="status">
          {state === "saving"
            ? say("Saving…", "保存中…")
            : state === "saved"
              ? say("Saved", "已保存")
              : state === "failed"
                ? say("Not saved. Check your connection.", "没有保存，请检查网络。")
                : say("Only you can see these.", "只有你能看到。")}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{open ? longDate(open, zh) : ""}</p>
            {open !== today && today && (
              <button
                type="button"
                onClick={() => setDate(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {say("Back to today", "回到今天")}
              </button>
            )}
          </div>
          <textarea
            value={draft}
            onChange={(event) => write(event.target.value)}
            disabled={notes === null || !open}
            rows={8}
            maxLength={20_000}
            placeholder={say(
              "What you think, what you are watching for, and why. It is saved as you type.",
              "你的看法、在等什么信号、为什么。输入时会自动保存。",
            )}
            className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {say("Earlier notes", "以前的笔记")}
          </p>
          {notes === null ? (
            <p className="mt-2 text-sm text-muted-foreground">{say("Loading…", "加载中…")}</p>
          ) : past.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {say("Nothing yet. Each day's note will be listed here.", "还没有。每天的笔记都会列在这里。")}
            </p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {past.map((note) => (
                <li key={note.date}>
                  <button
                    type="button"
                    onClick={() => setDate(note.date)}
                    className={cn(
                      "w-full rounded-lg px-2.5 py-2 text-left hover:bg-muted",
                      open === note.date && "bg-muted",
                    )}
                  >
                    <span className="block text-xs font-medium">{note.date}</span>
                    <span className="block truncate text-xs text-muted-foreground">{note.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
