"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { IndexLine } from "@/components/charts/index-line";
import { ArenaCommentary } from "@/components/arena/commentary";
import { PERIODS, type Leaderboard, type Period } from "@/lib/arena";
import type { Trophy as TrophyRecord } from "@/lib/arena/trophies";
import { cn, signClass } from "@/lib/utils";

const LABEL: Record<Period, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  max: "All time",
};

const MEDAL = ["text-chart-4", "text-muted-foreground", "text-chart-3"];

function pct(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * The family leaderboard.
 *
 * Percentages and an indexed curve, and nothing else. No account values, no
 * position sizes, no cash, no profit in dollars — how much money somebody
 * has is not what this is measuring, and it is not the others' business.
 * A percentage is also the only figure that compares honestly across
 * accounts of different sizes.
 */
export function ArenaBoard({
  boards,
  trophies,
}: {
  boards: Record<Period, Leaderboard>;
  trophies: TrophyRecord[];
}) {
  const [period, setPeriod] = useState<Period>("month");
  const board = boards[period];
  const ranked = board.standings.filter((s) => s.returnPercent !== null);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Arena</h1>
        <p className="text-sm text-muted-foreground">
          Ranked by return, so a bigger account does not simply win. Deposits
          are neutralised — adding money never looks like skill.
        </p>
      </header>

      <div className="flex flex-wrap gap-1">
        {PERIODS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPeriod(option)}
            className={cn(
              "min-h-9 rounded-lg px-3 text-sm transition-colors",
              option === period
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {LABEL[option]}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <ul className="divide-y divide-border">
          {board.standings.map((standing, position) => (
            <li
              key={standing.slug}
              className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="w-6 shrink-0 text-center text-sm tabular text-muted-foreground">
                {standing.returnPercent === null ? "—" : position + 1}
              </span>

              {standing.returnPercent !== null && position < 3 && ranked.length > 1 && (
                <Trophy
                  aria-label={`Rank ${position + 1}`}
                  className={cn("size-4 shrink-0", MEDAL[position])}
                />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {standing.displayName}
                  {standing.kind === "mock" && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      mock
                    </span>
                  )}
                </p>
                {standing.unavailable && (
                  <p className="text-xs text-muted-foreground">
                    {standing.unavailable}
                  </p>
                )}
              </div>

              <span
                className={cn(
                  "tabular text-sm font-medium",
                  signClass(standing.returnPercent ?? 0),
                )}
              >
                {pct(standing.returnPercent)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <ArenaCommentary period={period} />

      <TrophyCabinet trophies={trophies} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {board.standings
          .filter((standing) => standing.curve.length > 1)
          .map((standing, index) => (
            <IndexLine
              key={standing.slug}
              title={`${standing.displayName} · ${pct(standing.returnPercent)}`}
              note={`Indexed to 100 at the start of the ${LABEL[period].toLowerCase()}.`}
              data={standing.curve}
              colorIndex={index}
            />
          ))}
      </div>
    </div>
  );
}

const PLACE = ["1st", "2nd", "3rd"];

/**
 * What has actually been won, rather than who is ahead right now.
 *
 * Recorded when a period ends, so it does not change under you: the medal
 * beside the leaderboard is a live position, this is a result.
 */
function TrophyCabinet({ trophies }: { trophies: TrophyRecord[] }) {
  if (trophies.length === 0) return null;

  const byPortfolio = new Map<string, TrophyRecord[]>();
  for (const trophy of trophies) {
    const bucket = byPortfolio.get(trophy.portfolioName) ?? [];
    bucket.push(trophy);
    byPortfolio.set(trophy.portfolioName, bucket);
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">Trophy cabinet</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Finished periods only. Nothing here can change.
      </p>

      <ul className="mt-4 space-y-3">
        {[...byPortfolio].map(([name, won]) => {
          const firsts = won.filter((t) => t.rank === 1).length;
          return (
            <li key={name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{name}</span>
              {firsts > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-chart-4">
                  <Trophy className="size-3.5" aria-hidden="true" />
                  {firsts} win{firsts === 1 ? "" : "s"}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {won
                  .slice(0, 6)
                  .map(
                    (t) =>
                      `${PLACE[t.rank - 1] ?? `${t.rank}th`} · ${t.period} to ${t.periodEnd}`,
                  )
                  .join("  ·  ")}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
