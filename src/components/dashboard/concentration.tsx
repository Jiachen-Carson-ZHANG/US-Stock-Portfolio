"use client";

import Link from "next/link";
import { useLocale, useT } from "@/lib/i18n/context";
import { usePortfolioBase } from "@/lib/portfolios/path";
import { Help } from "@/components/ui/help";
import { seriesColor } from "@/components/charts/chart-kit";
import type { Concentration } from "@/types/portfolio";

/**
 * How much rides on the largest few companies.
 *
 * Stated as plain shares of what is invested, with no "safe" or "risky"
 * framing: a fact, not a judgement. The three headline figures sit in one row
 * and the companies below are bars, which is shorter to read than a numbered
 * list of contract codes and shows the gaps between them at a glance.
 */
export function ConcentrationTiles({ data }: { data: Concentration }) {
  const t = useT();
  const zh = useLocale() === "zh";
  const base = usePortfolioBase();

  const tiles = [
    { label: t.charts.topHolding, value: data.top1Percent },
    { label: t.charts.top3, value: data.top3Percent },
    { label: t.charts.top5, value: data.top5Percent },
  ];
  const largest = Math.max(1, ...(data.top ?? []).map((row) => row.percent));

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t.charts.concentration}
        <Help title={t.help.concentration}>{t.help.concentrationBody}</Help>
      </h3>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg bg-muted/40 px-2.5 py-2">
            <dt className="truncate text-[11px] text-muted-foreground">{tile.label}</dt>
            <dd className="tabular text-base font-semibold tracking-tight">{tile.value.toFixed(1)}%</dd>
          </div>
        ))}
      </dl>

      {data.top && data.top.length > 0 && (
        <ul className="mt-4 space-y-2">
          {data.top.map((row) => (
            <li key={row.symbol}>
              <Link
                href={`${base}/holdings/${encodeURIComponent(row.symbol)}`}
                className="group grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs"
              >
                <span className="truncate font-medium group-hover:underline">
                  {row.symbol}
                  {row.options && (
                    <span className="ml-1 font-normal text-muted-foreground">{zh ? "期权" : "opt"}</span>
                  )}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-muted/60">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(row.percent / largest) * 100}%`, background: seriesColor(0) }}
                  />
                </span>
                <span className="tabular text-right">{row.percent.toFixed(1)}%</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">{t.charts.concentrationNote}</p>
    </section>
  );
}
