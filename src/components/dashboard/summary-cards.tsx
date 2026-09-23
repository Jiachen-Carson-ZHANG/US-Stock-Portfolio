"use client";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import { currentSessionDate } from "@/lib/market-hours";
import { Help } from "@/components/ui/help";
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
  help,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  period?: string;
  /** What this figure actually means, for anyone who has not met it before. */
  help?: { title: string; body: string };
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <span className="flex items-center gap-0.5">
          <CardTitle className="truncate text-[10px] sm:text-xs">{label}</CardTitle>
          {help && <Help title={help.title}>{help.body}</Help>}
        </span>
        {/* Proportional figures: tabular-nums would read loose at this size. */}
        <p
          className={`mt-1.5 text-lg font-semibold tracking-tight sm:mt-2 sm:text-2xl ${tone ?? ""}`}
        >
          {value}
        </p>
        {sub && (
          <p className={`mt-0.5 text-xs sm:text-sm ${tone ?? "text-muted-foreground"}`}>{sub}</p>
        )}
        {children}
        {period && (
          <p className="mt-1.5 text-[10px] text-muted-foreground sm:mt-2 sm:text-[11px]">
            {period}
          </p>
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
    // Two across on a phone, not one. Four headline figures stacked one per
    // screen means scrolling past three of them to reach the fourth; side by
    // side they are all readable at a glance, which is what a summary is for.
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      <Stat
        label={t.summary.portfolioValue}
        help={{ title: t.help.portfolioValue, body: t.help.portfolioValueBody }}
        value={formatMoney(summary.totalMarketValue)}
        sub={`${summary.positionCount} ${t.summary.positions} · ${summary.cashPercent.toFixed(1)}% ${t.summary.cash}`}
        period={when(summary.dataTimestamp, t.summary.asAt)}
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

      {/* Today's profit belongs to a trading session, not to whenever the
          stalest thing held last printed a price. The old label read "session
          of 18 Sep" on the 22nd, because one option had not traded in four
          days. */}
      <Stat
        label={t.summary.today}
        help={{ title: t.help.today, body: t.help.todayBody }}
        value={formatMoney(summary.todayPnL, { signed: true })}
        sub={formatPercent(summary.todayPnLPercent, { signed: true })}
        tone={signClass(today)}
        period={when(currentSessionDate(), t.summary.sessionOf)}
      />

      <Stat
        label={t.summary.totalReturn}
        help={{ title: t.help.totalReturn, body: t.help.totalReturnBody }}
        value={formatMoney(summary.totalReturn, { signed: true })}
        sub={formatPercent(summary.totalReturnPercent, { signed: true })}
        tone={signClass(totalReturn)}
        period={when(since, t.summary.since)}
      />

      {/* "Invested" is the money actually paid in. Cash and cost of holdings
          sit beside it and do not add up to it, which reads as a mistake
          until you see the missing term: profit already taken went back into
          cash without ever having been paid in. The arithmetic is shown
          rather than asserted, because "why does 6,807 + 17,398 not make
          22,100?" is the first thing anyone asks. */}
      <Stat
        label={t.summary.totalInvested}
        help={{ title: t.help.totalInvested, body: t.help.totalInvestedBody }}
        value={formatMoney(summary.netDeposits ?? totalInvested)}
        sub={summary.netDeposits ? t.summary.paidIn : undefined}
        period={when(since, t.summary.since)}
      >
        {summary.netDeposits ? (
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t.summary.cash}</dt>
              <dd className="tabular">{formatMoney(summary.cashValue)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t.summary.costBasis}</dt>
              <dd className="tabular">{formatMoney(totalInvested)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">
                {realized >= 0 ? t.summary.lessProfitTaken : t.summary.plusLossTaken}
              </dt>
              <dd className={`tabular ${signClass(realized)}`}>
                {formatMoney(
                  { ...summary.realizedPnL, amount: String(-realized) },
                  { signed: true },
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-border pt-1">
              <dt className="text-muted-foreground">{t.summary.totalInvested}</dt>
              <dd className="tabular font-medium">
                {formatMoney(summary.netDeposits)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t.summary.cash} {formatMoney(summary.cashValue)}
          </p>
        )}
      </Stat>
    </div>
  );
}
