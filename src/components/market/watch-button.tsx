"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Adds a symbol to your own watchlist, or takes it off, from its page. */
export function WatchButton({ symbol, watching: initial }: { symbol: string; watching: boolean }) {
  const zh = useLocale() === "zh";
  const [watching, setWatching] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setFailed(null);
    const response = await fetch("/api/watch", {
      method: watching ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      setWatching(!watching);
      return;
    }
    const body = await response?.json().catch(() => null);
    setFailed(body?.error ?? (zh ? "没能保存，请重试。" : "Could not save. Try again."));
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={watching}
        className={cn(
          "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors",
          watching ? "border-accent bg-accent/5" : "border-border hover:bg-muted",
        )}
      >
        <Star className={cn("size-4", watching && "fill-current")} aria-hidden="true" />
        {watching ? (zh ? "已关注" : "Watching") : zh ? "加入自选" : "Watch"}
      </button>
      {failed && <span className="mt-1 text-xs text-negative">{failed}</span>}
    </span>
  );
}
