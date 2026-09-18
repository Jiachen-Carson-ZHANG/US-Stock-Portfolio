import type { Concentration } from "@/types/portfolio";

/**
 * Stated as plain shares of market value. Deliberately carries no "safe" or
 * "risky" framing — the spec forbids turning a factual figure into a judgement.
 */
export function ConcentrationTiles({ data }: { data: Concentration }) {
  const tiles = [
    { label: "Top holding", value: data.top1Percent },
    { label: "Top 3 holdings", value: data.top3Percent },
    { label: "Top 5 holdings", value: data.top5Percent },
  ];

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Concentration
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Share of long invested market value, excluding cash and short positions.
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
    </section>
  );
}
