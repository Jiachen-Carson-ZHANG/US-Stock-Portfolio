import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import type { PortfolioSummary } from "@/types/portfolio";

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <CardTitle>{label}</CardTitle>
        {/* Proportional figures: tabular-nums would read loose at this size. */}
        <p className={`mt-2 text-2xl font-semibold tracking-tight ${tone ?? ""}`}>
          {value}
        </p>
        {sub && <p className={`mt-0.5 text-sm ${tone ?? "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ summary }: { summary: PortfolioSummary }) {
  const today = Number(summary.todayPnL.amount);
  const unrealized = Number(summary.totalUnrealizedPnL.amount);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Portfolio value"
        value={formatMoney(summary.totalMarketValue)}
        sub={`${summary.positionCount} positions · ${summary.cashPercent.toFixed(1)}% cash`}
      />
      <Stat
        label="Today"
        value={formatMoney(summary.todayPnL, { signed: true })}
        sub={formatPercent(summary.todayPnLPercent, { signed: true })}
        tone={signClass(today)}
      />
      <Stat
        label="Unrealized P&L"
        value={formatMoney(summary.totalUnrealizedPnL, { signed: true })}
        sub={formatPercent(summary.totalUnrealizedPnLPercent, { signed: true })}
        tone={signClass(unrealized)}
      />
      <Stat
        label="Cost basis"
        value={formatMoney(summary.totalCostBasis)}
        sub={`Cash ${formatMoney(summary.cashValue)}`}
      />
    </div>
  );
}
