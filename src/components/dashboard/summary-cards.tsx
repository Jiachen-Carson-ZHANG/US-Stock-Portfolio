"use client";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import type { MoneyDTO, PortfolioSummary } from "@/types/portfolio";

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
        {sub && (
          <p className={`mt-0.5 text-sm ${tone ?? "text-muted-foreground"}`}>{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SummaryCards({
  summary,
  totalInvested,
}: {
  summary: PortfolioSummary;
  totalInvested: MoneyDTO;
}) {
  const t = useT();
  const today = Number(summary.todayPnL.amount);
  const unrealized = Number(summary.totalUnrealizedPnL.amount);
  const short = Number(summary.shortExposure.amount);

  const composition = [
    `${summary.positionCount} ${t.summary.positions}`,
    `${summary.cashPercent.toFixed(1)}% ${t.summary.cash}`,
    short !== 0 ? `${formatMoney(summary.shortExposure)} ${t.summary.short}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label={t.summary.portfolioValue}
        value={formatMoney(summary.totalMarketValue)}
        sub={composition}
      />
      <Stat
        label={t.summary.today}
        value={formatMoney(summary.todayPnL, { signed: true })}
        sub={formatPercent(summary.todayPnLPercent, { signed: true })}
        tone={signClass(today)}
      />
      <Stat
        label={t.summary.unrealized}
        value={formatMoney(summary.totalUnrealizedPnL, { signed: true })}
        sub={formatPercent(summary.totalUnrealizedPnLPercent, { signed: true })}
        tone={signClass(unrealized)}
      />
      <Stat
        label={t.summary.totalInvested}
        value={formatMoney(totalInvested)}
        sub={`${t.summary.cash} ${formatMoney(summary.cashValue)}`}
      />
    </div>
  );
}
