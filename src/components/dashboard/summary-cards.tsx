"use client";

import Link from "next/link";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatMoney, formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n/context";
import { currentSessionDate, marketDateString } from "@/lib/market-hours";
import { Help } from "@/components/ui/help";
import { formatDay } from "@/lib/local-time";
import type { PortfolioSummary } from "@/types/portfolio";

/**
 * A figure is meaningless without the window it covers. "Total return
 * +3.1%" invites "since when?", and the honest answer differs per card:
 * today's is one session, the return runs from the first deposit.
 *
 * Written in the app's language, not the device's, and read as a calendar
 * day: the device's locale made the server's text and the browser's differ,
 * which is one of the page-load errors the logs were full of.
 */
function when(
  iso: string | null | undefined,
  prefix: string,
  locale: "en" | "zh",
): string | undefined {
  if (!iso) return undefined;
  return `${prefix} ${formatDay(iso, locale)}`;
}

function Stat({
  label,
  value,
  sub,
  tone,
  period,
  help,
  children,
  compactOnPhone = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  period?: string;
  /** What this figure actually means, for anyone who has not met it before. */
  help?: { title: string; body: string };
  children?: React.ReactNode;
  compactOnPhone?: boolean;
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
        <div className={compactOnPhone ? "hidden sm:contents" : "contents"}>
          {sub && (
            <p className={`mt-0.5 text-xs sm:text-sm ${tone ?? "text-muted-foreground"}`}>{sub}</p>
          )}
          {children}
          {period && (
            <p className="mt-1.5 text-[10px] text-muted-foreground sm:mt-2 sm:text-[11px]">
              {period}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({
  summary,
  since,
  recordsHref,
}: {
  summary: PortfolioSummary;
  /** First day on record — what "total" is measured from. */
  since?: string | null;
  /** Where deposits are recorded, for whoever may record them. */
  recordsHref?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
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
        period={when(
          // The market's own date for the moment the prices are from, so it
          // reads the same in any timezone.
          summary.dataTimestamp ? marketDateString(new Date(summary.dataTimestamp)) : null,
          t.summary.asAt,
          locale,
        )}
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
        period={when(currentSessionDate(), t.summary.sessionOf, locale)}
      />

      <Stat
        label={t.summary.totalReturn}
        help={{ title: t.help.totalReturn, body: t.help.totalReturnBody }}
        value={formatMoney(summary.totalReturn, { signed: true })}
        sub={
          summary.netDeposits
            ? formatPercent(summary.totalReturnPercent, { signed: true })
            : `${formatPercent(summary.totalReturnPercent, { signed: true })} · ${t.summary.fromHoldingsOnly}`
        }
        tone={signClass(totalReturn)}
        // A running total, not a stale date: everything since the first day
        // on record.
        period={when(since, t.summary.allTimeFrom, locale)}
      />

      {/* Paid in, and only that. This card used to show cash plus holdings
          at cost less profit taken "adding up" to it — but the cost it used
          was not the one the balance uses (sold options count as a credit in
          one and not the other), so on the real account it came to $22,877
          beside a stated $22,100, and nobody could say why. A sum that does
          not add up is worse than none. With no deposits recorded it says so,
          rather than showing the cost of the holdings under this name. */}
      <Stat
        label={t.summary.totalInvested}
        compactOnPhone
        help={{ title: t.help.totalInvested, body: t.help.totalInvestedBody }}
        value={summary.netDeposits ? formatMoney(summary.netDeposits) : t.summary.notRecorded}
        sub={summary.netDeposits ? t.summary.paidIn : t.summary.notRecordedBody}
        period={summary.netDeposits ? when(since, t.summary.transfersFrom, locale) : undefined}
      >
        {summary.netDeposits ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{t.summary.fromTransfers}</p>
        ) : (
          recordsHref && (
            <Link
              href={recordsHref}
              className="mt-2 inline-block text-xs underline underline-offset-4"
            >
              {t.summary.addTransfers}
            </Link>
          )
        )}
      </Stat>
    </div>
  );
}
