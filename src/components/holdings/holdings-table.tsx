"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { cn, signClass } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { MoneyDTO, PositionView } from "@/types/portfolio";
import type { OptionGroupDTO, OptionStrategy } from "@/lib/portfolio/options";

export type HoldingRow =
  | { kind: "group"; id: string; group: OptionGroupDTO; weight: number }
  | { kind: "position"; id: string; position: PositionView; weight: number };

export function recordView(target: string) {
  void fetch("/api/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "view_position", target }),
  }).catch(() => {});
}

export function buildHoldingRows(
  positions: PositionView[],
  groups: OptionGroupDTO[],
): HoldingRow[] {
  const legSymbols = new Set(
    groups.flatMap((group) => group.legs.map((leg) => leg.symbol)),
  );

  const rows: HoldingRow[] = [
    ...groups.map((group) => ({
      kind: "group" as const,
      id: group.id,
      group,
      weight: group.weightPercent,
    })),
    ...positions
      .filter((position) => !legSymbols.has(position.symbol))
      .map((position) => ({
        kind: "position" as const,
        id: position.id,
        position,
        weight: position.investedWeightPercent ?? position.weightPercent,
      })),
  ];

  return rows.sort((a, b) => b.weight - a.weight);
}

export function strategyLabel(t: Dictionary, strategy: OptionStrategy): string {
  switch (strategy) {
    case "call-spread":
      return t.instrument.callSpread;
    case "put-spread":
      return t.instrument.putSpread;
    case "long-call":
      return t.instrument.longCall;
    case "long-put":
      return t.instrument.longPut;
    case "short-call":
      return t.instrument.shortCall;
    case "short-put":
      return t.instrument.shortPut;
    default:
      return t.instrument.option;
  }
}

function typeLabel(t: Dictionary, position: PositionView): string {
  switch (position.instrumentType) {
    case "stock":
      return t.instrument.stock;
    case "etf":
      return t.instrument.etf;
    case "cash":
      return t.instrument.cash;
    case "option":
      return position.optionType === "put" ? t.instrument.put : t.instrument.call;
    default:
      return t.instrument.other;
  }
}

function money(value: number | undefined, currency: string): string {
  if (value === undefined) return "—";
  return formatMoney({ amount: String(value), currency });
}

function qty(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function Outcome({
  label,
  value,
  fallback,
}: {
  label: string;
  value: MoneyDTO | null;
  fallback: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-sm font-medium">
        {value ? formatMoney(value, { signed: true }) : fallback}
      </p>
    </div>
  );
}

function GroupDetail({ group }: { group: OptionGroupDTO }) {
  const t = useT();

  return (
    <div className="space-y-4 px-4 py-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">
            {Number(group.netCost.amount) >= 0
              ? t.position.netDebit
              : t.position.netCredit}
          </p>
          <p className="tabular mt-0.5 text-sm font-medium">
            {formatMoney({
              amount: String(Math.abs(Number(group.netCost.amount))),
              currency: group.netCost.currency,
            })}
          </p>
        </div>
        <Outcome
          label={t.position.maxProfit}
          value={group.maxProfit}
          fallback={t.position.unlimited}
        />
        <Outcome
          label={t.position.maxLoss}
          value={group.maxLoss}
          fallback={t.position.unlimited}
        />
        <div>
          <p className="text-xs text-muted-foreground">{t.position.breakEven}</p>
          <p className="tabular mt-0.5 text-sm font-medium">
            {group.breakEven === null ? "—" : group.breakEven.toFixed(2)}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t.position.legs}
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {group.legs.map((leg) => (
            <li
              key={leg.symbol}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
            >
              <Link
                href={`/holdings/${encodeURIComponent(leg.symbol)}`}
                onClick={() => recordView(leg.symbol)}
                className="font-medium hover:underline"
              >
                {leg.quantity > 0 ? "+" : ""}
                {leg.quantity} {leg.optionType === "put" ? "P" : "C"}
                {leg.strike}
              </Link>
              <span className="text-muted-foreground">{leg.expirationDate}</span>
              <span className="tabular ml-auto text-muted-foreground">
                {money(leg.currentPrice, leg.currency)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PositionDetail({ position }: { position: PositionView }) {
  const t = useT();

  const rows = [
    { label: t.position.costBasis, value: formatMoney(position.costBasis) },
    { label: t.position.sector, value: position.sector ?? "—" },
    {
      label: t.position.currentPrice,
      value: money(position.currentPrice, position.currency),
    },
    { label: t.position.currency, value: position.currency },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-4">
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-xs text-muted-foreground">{row.label}</p>
          <p className="tabular mt-0.5 text-sm">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

export function HoldingsTable({
  positions,
  optionGroups,
}: {
  positions: PositionView[];
  optionGroups: OptionGroupDTO[];
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = buildHoldingRows(positions, optionGroups);

  function toggle(id: string, target?: string) {
    setExpanded((current) => {
      const next = current === id ? null : id;
      if (next && target) recordView(target);
      return next;
    });
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t.table.holdings}</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 text-left font-medium">{t.table.symbol}</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">{t.table.type}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.qty}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.cost}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.price}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.marketValue}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.today}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.unrealized}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.weight}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expanded === row.id;

              if (row.kind === "group") {
                const g = row.group;
                const unrealized = Number(g.unrealizedPnL.amount);
                const today = Number(g.todayPnL.amount);

                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => toggle(row.id, g.underlying)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted"
                    >
                      <th scope="row" className="px-4 py-3 text-left font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronRight
                            aria-hidden="true"
                            className={cn(
                              "size-3.5 text-muted-foreground transition-transform",
                              isOpen && "rotate-90",
                            )}
                          />
                          {g.underlying}
                        </span>
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {g.expirationDate}
                        </span>
                      </th>
                      <td className="px-4 py-3 text-muted-foreground">
                        {strategyLabel(t, g.strategy)}
                      </td>
                      <td className="tabular px-4 py-3 text-right">
                        {g.legs.length} {t.position.legs.toLowerCase()}
                      </td>
                      <td className="tabular px-4 py-3 text-right">
                        {formatMoney(g.netCost)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                      <td className="tabular px-4 py-3 text-right font-medium">
                        {formatMoney(g.netMarketValue)}
                      </td>
                      <td className={cn("tabular px-4 py-3 text-right", signClass(today))}>
                        {formatMoney(g.todayPnL, { signed: true })}
                      </td>
                      <td className={cn("tabular px-4 py-3 text-right", signClass(unrealized))}>
                        {formatMoney(g.unrealizedPnL, { signed: true })}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-muted-foreground">
                        {row.weight.toFixed(1)}%
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border bg-muted/40">
                        <td colSpan={9}>
                          <GroupDetail group={g} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }

              const p = row.position;
              const isCash = p.instrumentType === "cash";

              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => !isCash && toggle(row.id, p.symbol)}
                    className={cn(
                      "border-b border-border last:border-0",
                      !isCash && "cursor-pointer hover:bg-muted",
                    )}
                  >
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      {isCash ? (
                        p.symbol
                      ) : (
                        <Link
                          href={`/holdings/${encodeURIComponent(p.symbol)}`}
                          className="hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            recordView(p.symbol);
                          }}
                        >
                          {p.symbol}
                        </Link>
                      )}
                      {p.name && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {p.name}
                        </span>
                      )}
                    </th>
                    <td className="px-4 py-3 text-muted-foreground">{typeLabel(t, p)}</td>
                    <td className="tabular px-4 py-3 text-right">{qty(p.quantity)}</td>
                    <td className="tabular px-4 py-3 text-right">
                      {isCash ? "—" : formatMoney(p.costBasis)}
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {isCash ? "—" : money(p.currentPrice, p.currency)}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">
                      {formatMoney(p.marketValue)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right",
                        signClass(Number(p.todayPnL.amount)),
                      )}
                    >
                      {isCash ? "—" : formatMoney(p.todayPnL, { signed: true })}
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right",
                        signClass(Number(p.unrealizedPnL.amount)),
                      )}
                    >
                      {isCash ? "—" : formatMoney(p.unrealizedPnL, { signed: true })}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-muted-foreground">
                      {row.weight.toFixed(1)}%
                    </td>
                  </tr>
                  {isOpen && !isCash && (
                    <tr className="border-b border-border bg-muted/40">
                      <td colSpan={9}>
                        <PositionDetail position={p} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards, no horizontal scrolling. */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((row) => {
          const isOpen = expanded === row.id;
          const isGroup = row.kind === "group";

          const title = isGroup ? row.group.underlying : row.position.symbol;
          const subtitle = isGroup
            ? `${strategyLabel(t, row.group.strategy)} · ${row.group.expirationDate ?? ""}`
            : (row.position.name ?? typeLabel(t, row.position));
          const value = isGroup ? row.group.netMarketValue : row.position.marketValue;
          const unrealized = isGroup
            ? row.group.unrealizedPnL
            : row.position.unrealizedPnL;
          const today = isGroup ? row.group.todayPnL : row.position.todayPnL;
          const isCash = !isGroup && row.position.instrumentType === "cash";

          return (
            <li key={row.id} className="rounded-xl border border-border bg-surface">
              <button
                type="button"
                onClick={() => toggle(row.id, title)}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-medium">{formatMoney(value)}</p>
                  <p className="tabular text-xs">
                    <span className={signClass(Number(today.amount))}>
                      {isCash ? "—" : formatMoney(today, { signed: true })}
                    </span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <span className={signClass(Number(unrealized.amount))}>
                      {isCash ? "—" : formatMoney(unrealized, { signed: true })}
                    </span>
                  </p>
                </div>

                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
              </button>

              {isOpen && (
                <div className="border-t border-border">
                  {isGroup ? (
                    <GroupDetail group={row.group} />
                  ) : (
                    <>
                      <PositionDetail position={row.position} />
                      {!isCash && (
                        <div className="px-4 pb-3">
                          <Link
                            href={`/holdings/${encodeURIComponent(row.position.symbol)}`}
                            onClick={() => recordView(row.position.symbol)}
                            className="text-sm underline underline-offset-4"
                          >
                            {t.position.facts}
                          </Link>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
