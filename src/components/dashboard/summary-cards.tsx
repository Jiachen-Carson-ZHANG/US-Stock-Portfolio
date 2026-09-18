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
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  children?: React.ReactNode;
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
        {children}
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
  const totalReturn = Number(summary.totalReturn.amount);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label={t.summary.portfolioValue}
        value={formatMoney(summary.totalMarketValue)}
        sub={`${summary.positionCount} ${t.summary.positions} · ${summary.cashPercent.toFixed(1)}% ${t.summary.cash}`}
      >
        <p className={`mt-1.5 text-xs ${signClass(unrealized)}`}>
          {formatMoney(summary.totalUnrealizedPnL, { signed: true })} ·{" "}
          {formatPercent(summary.totalUnrealizedPnLPercent, { signed: true })}{" "}
          <span className="text-muted-foreground">{t.summary.unrealized}</span>
        </p>
      </Stat>

      <Stat
        label={t.summary.today}
        value={formatMoney(summary.todayPnL, { signed: true })}
        sub={formatPercent(summary.todayPnLPercent, { signed: true })}
        tone={signClass(today)}
      />

      <Stat
        label={t.summary.totalReturn}
        value={formatMoney(summary.totalReturn, { signed: true })}
        sub={formatPercent(summary.totalReturnPercent, { signed: true })}
        tone={signClass(totalReturn)}
      >
        {/* Naming the base makes the headline checkable: value less deposits
            is the return. Without a configured figure the base is inferred
            from the broker's realized P&L, so that is what gets shown. */}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {summary.netDeposits
            ? `${t.summary.netDeposits} ${formatMoney(summary.netDeposits)}`
            : `${t.summary.realized} ${formatMoney(summary.realizedPnL, { signed: true })}`}
        </p>
      </Stat>

      <Stat
        label={t.summary.totalInvested}
        value={formatMoney(totalInvested)}
        sub={`${t.summary.cash} ${formatMoney(summary.cashValue)}`}
      />
    </div>
  );
}
