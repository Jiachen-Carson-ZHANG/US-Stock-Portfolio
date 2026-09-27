"use client";

import { useT } from "@/lib/i18n/context";
import { Help } from "@/components/ui/help";
import type { Concentration } from "@/types/portfolio";

/**
 * Stated as plain shares of invested capital. Deliberately carries no "safe" or
 * "risky" framing — a factual figure, not a judgement.
 */
export function ConcentrationTiles({ data }: { data: Concentration }) {
  const t = useT();

  const tiles = [
    { label: t.charts.topHolding, value: data.top1Percent },
    { label: t.charts.top3, value: data.top3Percent },
    { label: t.charts.top5, value: data.top5Percent },
  ];

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t.charts.concentration}
        <Help title={t.help.concentration}>{t.help.concentrationBody}</Help>
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.charts.concentrationNote}
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight">
              {tile.value.toFixed(1)}%
            </dd>
          </div>
        ))}
      </dl>
      {data.top && data.top.length > 0 && (
        <ol className="mt-4 space-y-1 border-t border-border pt-3 text-xs">
          {data.top.map((holding, index) => (
            <li key={holding.symbol} className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {index + 1}. <span className="font-medium text-foreground">{holding.symbol}</span>
              </span>
              <span className="tabular">{holding.percent.toFixed(1)}%</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
