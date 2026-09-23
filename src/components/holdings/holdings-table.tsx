"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { spreadPrices } from "@/lib/portfolio/chart-data";
import { usePortfolioBase } from "@/lib/portfolios/path";
import { cn, signClass } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n/context";
import { Help } from "@/components/ui/help";
import { localizedName } from "@/lib/i18n/symbols";
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

/**
 * What one share or contract cost, taken from the cost basis rather than the
 * broker's average. moomoo nets realized proceeds against that average, so on
 * a partly sold holding it comes back negative — NVDA reports -229.89 here.
 * Dividing the cost basis keeps this consistent with the cost column beside it.
 */
function unitCost(p: PositionView): number | undefined {
  const units = p.quantity * (p.instrumentType === "option" ? (p.contractMultiplier ?? 100) : 1);
  if (!units) return undefined;
  const basis = Number(p.costBasis.amount);
  if (!Number.isFinite(basis)) return undefined;
  return basis / units;
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
  const base = usePortfolioBase();

  return (
    <div className="space-y-4 px-4 py-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
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
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {t.position.breakEven}
            <Help title={t.help.breakEven} align="right">
              {t.help.breakEvenBody}
            </Help>
          </p>
          <p className="tabular mt-0.5 text-sm font-medium">
            {group.breakEven === null ? "—" : group.breakEven.toFixed(2)}
          </p>
        </div>

        {/* A field of its own rather than a footnote under break-even. It is
            the share's own price, not a property of the break-even, and
            tucking it underneath read as though it were one. Comparing the
            two is still the point — they sit side by side. */}
        <div>
          <p className="text-xs text-muted-foreground">{t.position.stockPrice}</p>
          <p
            className={cn(
              "tabular mt-0.5 text-sm font-medium",
              group.breakEven !== null &&
                group.underlyingPrice !== undefined &&
                signClass(group.underlyingPrice - group.breakEven),
            )}
          >
            {group.underlyingPrice === undefined
              ? "—"
              : money(group.underlyingPrice, group.netCost.currency)}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t.position.legs}
          <Help title={t.help.optionPrice}>{t.help.optionPriceBody}</Help>
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {group.legs.map((leg) => (
            <li
              key={leg.symbol}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
            >
              <Link
                href={`${base}/holdings/${encodeURIComponent(leg.symbol)}`}
                onClick={() => recordView(leg.symbol)}
                className="font-medium hover:underline"
              >
                {leg.quantity > 0 ? "+" : ""}
                {leg.quantity} {leg.optionType === "put" ? "P" : "C"}
                {leg.strike}
              </Link>
              <span className="text-muted-foreground">{leg.expirationDate}</span>
              {/* Same shape as a stock row: what the contract is worth now,
                  with what it cost in grey underneath, so the comparison
                  needs no arithmetic. */}
              <span className="ml-auto text-right">
                <span className="tabular block">{money(leg.currentPrice, leg.currency)}</span>
                <span
                  className="tabular block text-xs text-muted-foreground"
                  title={t.position.averageCost}
                >
                  {t.position.paid} {money(group.legCost[leg.symbol], leg.currency)}
                </span>
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
  const locale = useLocale();
  const base = usePortfolioBase();
  // A set, not a single id: opening one spread used to close the one you were
  // already looking at, which makes two positions impossible to compare.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const rows = buildHoldingRows(positions, optionGroups);

  function toggle(id: string, target?: string) {
    const opening = !expanded.has(id);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
    if (opening && target) recordView(target);
  }

  return (
    <>
      {/* A tablet sat between the two layouts: wide enough for the sidebar, too
          narrow for the table, so it got phone cards with a desktop chrome
          around them. The table now starts at the same width the sidebar
          does, and sheds the four least important columns until there is room
          for them. */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t.table.holdings}</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 text-left font-medium">{t.table.symbol}</th>
              <th scope="col" className="hidden lg:table-cell px-4 py-3 text-left font-medium">{t.table.type}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.qty}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.price}</th>
              <th scope="col" className="hidden lg:table-cell px-4 py-3 text-right font-medium">{t.table.today}</th>
              <th scope="col" className="hidden lg:table-cell px-4 py-3 text-right font-medium">{t.table.cost}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.marketValue}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t.table.unrealized}</th>
              <th scope="col" className="hidden lg:table-cell px-4 py-3 text-right font-medium">{t.table.weight}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expanded.has(row.id);

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
                      <td className="hidden lg:table-cell px-4 py-3 text-muted-foreground">
                        {strategyLabel(t, g.strategy)}
                      </td>
                      <td className="tabular px-4 py-3 text-right">
                        {g.legs.length} {t.position.legs.toLowerCase()}
                      </td>
                      <td className="tabular px-4 py-3 text-right">
                        {(() => {
                          const prices = spreadPrices(g);
                          if (!prices) return "—";
                          return (
                            <>
                              <div>{money(prices.now, g.netCost.currency)}</div>
                              <div
                                className="text-xs font-normal text-muted-foreground"
                                title={t.position.averageCost}
                              >
                                {money(prices.paid, g.netCost.currency)}
                              </div>
                            </>
                          );
                        })()}
                      </td>
                      <td className={cn("hidden lg:table-cell tabular px-4 py-3 text-right", signClass(today))}>
                        {formatMoney(g.todayPnL, { signed: true })}
                      </td>
                      <td className="hidden lg:table-cell tabular px-4 py-3 text-right">
                        {formatMoney(g.netCost)}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-medium">
                        {formatMoney(g.netMarketValue)}
                      </td>
                      <td className={cn("tabular px-4 py-3 text-right", signClass(unrealized))}>
                        {formatMoney(g.unrealizedPnL, { signed: true })}
                      </td>
                      <td className="hidden lg:table-cell tabular px-4 py-3 text-right text-muted-foreground">
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
                          href={`${base}/holdings/${encodeURIComponent(p.symbol)}`}
                          className="hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            recordView(p.symbol);
                          }}
                        >
                          {p.symbol}
                        </Link>
                      )}
                      {localizedName(p.symbol, p.name, locale) && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {localizedName(p.symbol, p.name, locale)}
                        </span>
                      )}
                    </th>
                    <td className="hidden lg:table-cell px-4 py-3 text-muted-foreground">{typeLabel(t, p)}</td>
                    <td className="tabular px-4 py-3 text-right">{qty(p.quantity)}</td>
                    <td className="tabular px-4 py-3 text-right">
                      {isCash ? (
                        "—"
                      ) : (
                        <>
                          <div>{money(p.currentPrice, p.currency)}</div>
                          {/* What it cost, directly beneath what it is worth, so the
                              comparison needs no arithmetic. Derived from the cost
                              basis rather than the broker average, which nets realized
                              proceeds and can come back negative. */}
                          <div
                            className="text-xs font-normal text-muted-foreground"
                            title={t.position.averageCost}
                          >
                            {money(unitCost(p), p.currency)}
                          </div>
                        </>
                      )}
                    </td>
                    <td
                      className={cn(
                        "hidden lg:table-cell tabular px-4 py-3 text-right",
                        signClass(Number(p.todayPnL.amount)),
                      )}
                    >
                      {isCash ? "—" : formatMoney(p.todayPnL, { signed: true })}
                    </td>
                    <td className="hidden lg:table-cell tabular px-4 py-3 text-right">
                      {isCash ? "—" : formatMoney(p.costBasis)}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">
                      {formatMoney(p.marketValue)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right",
                        signClass(Number(p.unrealizedPnL.amount)),
                      )}
                    >
                      {isCash ? "—" : formatMoney(p.unrealizedPnL, { signed: true })}
                    </td>
                    <td className="hidden lg:table-cell tabular px-4 py-3 text-right text-muted-foreground">
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
      <ul className="space-y-1.5 md:hidden">
        {rows.map((row) => {
          const isOpen = expanded.has(row.id);
          const isGroup = row.kind === "group";

          const title = isGroup ? row.group.underlying : row.position.symbol;
          const subtitle = isGroup
            ? `${strategyLabel(t, row.group.strategy)} · ${row.group.expirationDate ?? ""}`
            : (localizedName(row.position.symbol, row.position.name, locale) ??
              typeLabel(t, row.position));
          const value = isGroup ? row.group.netMarketValue : row.position.marketValue;
          const unrealized = isGroup
            ? row.group.unrealizedPnL
            : row.position.unrealizedPnL;
          const today = isGroup ? row.group.todayPnL : row.position.todayPnL;
          const isCash = !isGroup && row.position.instrumentType === "cash";

          return (
            <li key={row.id} className="rounded-xl border border-border bg-surface">
              {/* Tighter than it was, and carrying more. The old card spent a
                  whole row of height on a name and showed neither the price
                  nor the share of the account, so reading a holding meant
                  opening it. */}
              <button
                type="button"
                onClick={() => toggle(row.id, title)}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">{title}</p>
                  <p className="truncate text-[11px] leading-tight text-muted-foreground">
                    {subtitle}
                  </p>
                  <p className="truncate text-[11px] leading-tight text-muted-foreground">
                    {isGroup
                      ? (() => {
                          const prices = spreadPrices(row.group);
                          return prices
                            ? `${money(prices.now, row.group.netCost.currency)} · ${money(prices.paid, row.group.netCost.currency)} ${t.position.averageCost.toLowerCase()}`
                            : "";
                        })()
                      : isCash
                        ? ""
                        : `${money(row.position.currentPrice, row.position.currency)} · ${money(unitCost(row.position), row.position.currency)} ${t.position.averageCost.toLowerCase()}`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-medium leading-tight">
                    {formatMoney(value)}
                  </p>
                  <p className="tabular text-[11px] leading-tight">
                    <span className={signClass(Number(today.amount))}>
                      {isCash ? "—" : formatMoney(today, { signed: true })}
                    </span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <span className={signClass(Number(unrealized.amount))}>
                      {isCash ? "—" : formatMoney(unrealized, { signed: true })}
                    </span>
                  </p>
                  <p className="tabular text-[11px] leading-tight text-muted-foreground">
                    {row.weight.toFixed(1)}% {t.table.weight.toLowerCase()}
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
                            href={`${base}/holdings/${encodeURIComponent(row.position.symbol)}`}
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
