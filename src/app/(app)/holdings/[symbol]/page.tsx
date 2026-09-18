import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { loadPosition } from "@/lib/portfolio/service";
import { getMarketDataProvider } from "@/providers";
import { daysToExpiration } from "@/lib/portfolio";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { symbolSchema } from "@/lib/schemas";
import { ValueLine } from "@/components/charts/value-line";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/misc";
import type { PositionView } from "@/types/portfolio";

export const dynamic = "force-dynamic";

const HISTORY_DAYS = 180;

function Facts({ position }: { position: PositionView }) {
  const money = (value: number | undefined) =>
    value === undefined ? "—" : formatMoney({ amount: String(value), currency: position.currency });

  const shared = [
    { label: "Quantity", value: String(position.quantity) },
    { label: "Average cost", value: money(position.averageCost) },
    { label: "Current price", value: money(position.currentPrice) },
    { label: "Previous close", value: money(position.previousClose) },
    { label: "Market value", value: formatMoney(position.marketValue) },
    { label: "Cost basis", value: formatMoney(position.costBasis) },
    { label: "Portfolio weight", value: `${position.weightPercent.toFixed(2)}%` },
  ];

  const optionFacts =
    position.instrumentType === "option"
      ? [
          { label: "Underlying", value: position.underlyingSymbol ?? "—" },
          { label: "Call / Put", value: position.optionType === "put" ? "Put" : "Call" },
          { label: "Strike", value: money(position.strike) },
          { label: "Expiration", value: position.expirationDate ?? "—" },
          {
            label: "Days to expiration",
            value: position.expirationDate
              ? String(daysToExpiration(position.expirationDate))
              : "—",
          },
          { label: "Multiplier", value: String(position.contractMultiplier ?? 100) },
        ]
      : [{ label: "Sector", value: position.sector ?? "—" }];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
      {[...shared, ...optionFacts].map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className="tabular mt-1 text-sm font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function PositionDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  await requireUser();

  const raw = decodeURIComponent((await params).symbol);
  const parsed = symbolSchema.safeParse(raw);
  if (!parsed.success) notFound();

  const position = await loadPosition(parsed.data);
  if (!position) notFound();

  const to = new Date();
  const from = new Date(to.getTime() - HISTORY_DAYS * 86_400_000);
  const prices = await getMarketDataProvider().getHistoricalPrices(position.symbol, {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });

  const multiplier =
    position.instrumentType === "option" ? position.contractMultiplier ?? 100 : 1;

  const unrealized = Number(position.unrealizedPnL.amount);
  const today = Number(position.todayPnL.amount);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/holdings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Holdings
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{position.symbol}</h1>
            <Badge>{position.instrumentType}</Badge>
          </div>
          {position.name && (
            <p className="mt-0.5 text-sm text-muted-foreground">{position.name}</p>
          )}
        </div>

        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight">
            {formatMoney(position.marketValue)}
          </p>
          <p className={`text-sm ${signClass(today)}`}>
            {formatMoney(position.todayPnL, { signed: true })} today
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <CardTitle>Unrealized P&L</CardTitle>
            <p className={`mt-2 text-xl font-semibold ${signClass(unrealized)}`}>
              {formatMoney(position.unrealizedPnL, { signed: true })}
            </p>
            <p className={`text-sm ${signClass(unrealized)}`}>
              {formatPercent(position.unrealizedPnLPercent, { signed: true })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <CardTitle>Today</CardTitle>
            <p className={`mt-2 text-xl font-semibold ${signClass(today)}`}>
              {formatMoney(position.todayPnL, { signed: true })}
            </p>
            <p className={`text-sm ${signClass(today)}`}>
              {formatPercent(position.todayPnLPercent, { signed: true })}
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Position facts
        </h2>
        <Facts position={position} />
      </section>

      <ValueLine
        title="Price history"
        note={`Last ${HISTORY_DAYS} days.`}
        valueLabel="Close"
        data={prices.map((p) => ({ date: p.date, value: p.close }))}
      />

      <ValueLine
        title="Position value history"
        note="Close price × quantity, at today's holding size."
        valueLabel="Position value"
        data={prices.map((p) => ({
          date: p.date,
          value: p.close * position.quantity * multiplier,
        }))}
      />
    </div>
  );
}
