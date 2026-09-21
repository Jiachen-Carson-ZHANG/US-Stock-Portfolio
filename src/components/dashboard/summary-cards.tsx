"use client";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import type { MoneyDTO, PortfolioSummary } from "@/types/portfolio";

/**
 * A figure is meaningless without the window it covers. "Total return
 * +3.1%" invites "since when?", and the honest answer differs per card:
 * today's is one session, the return runs from the first deposit.
 */
function when(iso: string | null | undefined, prefix: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  return `${prefix} ${date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function Stat({
  label,
  value,
  sub,
  tone,
  period,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  period?: string;
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
        {period && (
          <p className="mt-2 text-[11px] text-muted-foreground">{period}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SummaryCards({
  summary,
  totalInvested,
  since,
}: {
  summary: PortfolioSummary;
  totalInvested: MoneyDTO;
  /** First day on record — what "total" is measured from. */
  since?: string | null;
}) {
  const t = useT();
  const today = Number(summary.todayPnL.amount);
  const unrealized = Number(summary.totalUnrealizedPnL.amount);
  const totalReturn = Number(summary.totalReturn.amount);
  const realized = Number(summary.realizedPnL.amount);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label={t.summary.portfolioValue}
        value={formatMoney(summary.totalMarketValue)}
        sub={`${summary.positionCount} ${t.summary.positions} · ${summary.cashPercent.toFixed(1)}% ${t.summary.cash}`}
        period={when(summary.dataTimestamp, "as at")}
      >
        <p className={`mt-1.5 text-xs ${signClass(unrealized)}`}>
          {formatMoney(summary.totalUnrealizedPnL, { signed: true })} ·{" "}
          {formatPercent(summary.totalUnrealizedPnLPercent, { signed: true })}{" "}
          <span className="text-muted-foreground">{t.summary.unrealized}</span>
        </p>
        <p className={`mt-0.5 text-xs ${signClass(realized)}`}>
          {formatMoney(summary.realizedPnL, { signed: true })} ·{" "}
          {formatPercent(summary.realizedPnLPercent, { signed: true })}{" "}
          <span className="text-muted-foreground">{t.summary.realized}</span>
        </p>
      </Stat>

      <Stat
        label={t.summary.today}
        value={formatMoney(summary.todayPnL, { signed: true })}
        sub={formatPercent(summary.todayPnLPercent, { signed: true })}
        tone={signClass(today)}
        period={when(summary.dataTimestamp, "session of")}
      />

      <Stat
        label={t.summary.totalReturn}
        value={formatMoney(summary.totalReturn, { signed: true })}
        sub={formatPercent(summary.totalReturnPercent, { signed: true })}
        tone={signClass(totalReturn)}
        period={when(since, "since")}
      />

      {/* "Invested" means the money actually put in, when that is known. Cost
          of holdings is a different quantity — it excludes cash and moves with
          every trade — so it is kept, in smaller type, rather than conflated
          with the deposit. Value less deposits is then the return above. */}
      <Stat
        label={t.summary.totalInvested}
        value={formatMoney(summary.netDeposits ?? totalInvested)}
        sub={`${t.summary.cash} ${formatMoney(summary.cashValue)}`}
        period={when(since, "since")}
      >
        {summary.netDeposits && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t.summary.costBasis} {formatMoney(totalInvested)}
          </p>
        )}
      </Stat>
    </div>
  );
}
