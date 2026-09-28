"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/i18n/context";
import type { Period } from "@/lib/arena";

type Result = {
  text: string;
  sources: { title: string; url: string }[];
};

const PERIOD_EN: Record<Period, string> = {
  day: "today",
  week: "this week",
  month: "this month",
  year: "this year",
  max: "all time",
};
const PERIOD_ZH: Record<Period, string> = { day: "今天", week: "本周", month: "本月", year: "今年", max: "全部时间" };

/**
 * The commentator's write-up for the selected period.
 *
 * Asked for rather than generated on load: it costs a model call and a few
 * searches, and nobody wants that on every page view. The button is also an
 * honest signal that a person chose to invoke it.
 */
export function ArenaCommentary({ period }: { period: Period }) {
  const t = useT();
  const zh = useLocale() === "zh";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function write() {
    setBusy(true);
    setError(null);
    setResult(null);

    const response = await fetch("/api/arena/commentary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? t.arena.commentaryFailed);
      return;
    }
    setResult(body);
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{t.arena.commentary}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.arena.commentaryNote}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={write} disabled={busy}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          {busy ? t.arena.writing : result ? t.arena.again : t.arena.report.replace("{period}", (zh ? PERIOD_ZH : PERIOD_EN)[period])}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-negative">
          {error}
        </p>
      )}

      {result && (
        <>
          <div className="mt-4 space-y-3 text-sm leading-relaxed">
            {result.text.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>

          {result.sources.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                {t.arena.sources}
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            {t.arena.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}
