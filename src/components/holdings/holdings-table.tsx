"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatMoney, formatPercent } from "@/lib/money";
import { cn, signClass } from "@/lib/utils";
import type { PositionView } from "@/types/portfolio";

const TYPE_LABEL: Record<PositionView["instrumentType"], string> = {
  stock: "Stock",
  etf: "ETF",
  option: "Option",
  cash: "Cash",
  other: "Other",
};

function price(value: number | undefined, currency: string): string {
  if (value === undefined) return "—";
  return formatMoney({ amount: String(value), currency });
}

function quantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function ExpandedDetail({ position }: { position: PositionView }) {
  const rows: { label: string; value: string }[] =
    position.instrumentType === "option"
      ? [
          { label: "Underlying", value: position.underlyingSymbol ?? "—" },
          { label: "Type", value: position.optionType === "put" ? "Put" : "Call" },
          { label: "Strike", value: price(position.strike, position.currency) },
          { label: "Expiration", value: position.expirationDate ?? "—" },
          { label: "Multiplier", value: String(position.contractMultiplier ?? 100) },
          { label: "Cost basis", value: formatMoney(position.costBasis) },
        ]
      : [
          { label: "Cost basis", value: formatMoney(position.costBasis) },
          { label: "Sector", value: position.sector ?? "—" },
          { label: "Today", value: formatMoney(position.todayPnL, { signed: true }) },
          { label: "Currency", value: position.currency },
        ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-xs text-muted-foreground">{row.label}</p>
          <p className="tabular mt-0.5 text-sm">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

export function HoldingsTable({ positions }: { positions: PositionView[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  function toggle(id: string) {
    setExpanded((current) => (current === id ? null : id));
  }

  return (
    <>
      {/* Desktop: every column. */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Portfolio holdings</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 text-left font-medium">Symbol</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Name</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Type</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Qty</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Avg cost</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Price</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Market value</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Today</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Unrealized</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const isCash = position.instrumentType === "cash";
              const isOpen = expanded === position.id;

              return (
                <Fragment key={position.id}>
                  <tr
                    onClick={() => !isCash && toggle(position.id)}
                    className={cn(
                      "border-b border-border last:border-0",
                      !isCash && "cursor-pointer hover:bg-muted",
                    )}
                  >
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      {isCash ? (
                        position.symbol
                      ) : (
                        <Link
                          href={`/holdings/${encodeURIComponent(position.symbol)}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {position.symbol}
                        </Link>
                      )}
                    </th>
                    <td className="max-w-56 truncate px-4 py-3 text-muted-foreground">
                      {position.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {TYPE_LABEL[position.instrumentType]}
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {quantity(position.quantity)}
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {isCash ? "—" : price(position.averageCost, position.currency)}
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {isCash ? "—" : price(position.currentPrice, position.currency)}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-medium">
                      {formatMoney(position.marketValue)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right",
                        signClass(position.todayPnLPercent),
                      )}
                    >
                      {isCash
                        ? "—"
                        : formatPercent(position.todayPnLPercent, { signed: true })}
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right",
                        signClass(Number(position.unrealizedPnL.amount)),
                      )}
                    >
                      {isCash
                        ? "—"
                        : formatMoney(position.unrealizedPnL, { signed: true })}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-muted-foreground">
                      {position.weightPercent.toFixed(1)}%
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-border bg-muted/40">
                      <td colSpan={10}>
                        <ExpandedDetail position={position} />
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
        {positions.map((position) => {
          const isCash = position.instrumentType === "cash";
          const isOpen = expanded === position.id;

          return (
            <li key={position.id} className="rounded-xl border border-border bg-surface">
              <button
                type="button"
                onClick={() => toggle(position.id)}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{position.symbol}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {position.name ?? TYPE_LABEL[position.instrumentType]}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-medium">
                    {formatMoney(position.marketValue)}
                  </p>
                  <p className="tabular text-xs">
                    <span className={signClass(position.todayPnLPercent)}>
                      {isCash
                        ? "—"
                        : formatPercent(position.todayPnLPercent, { signed: true })}
                    </span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <span className={signClass(Number(position.unrealizedPnL.amount))}>
                      {isCash
                        ? "—"
                        : formatMoney(position.unrealizedPnL, { signed: true })}
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
                  <ExpandedDetail position={position} />
                  {!isCash && (
                    <div className="px-4 pb-3">
                      <Link
                        href={`/holdings/${encodeURIComponent(position.symbol)}`}
                        className="text-sm underline underline-offset-4"
                      >
                        View position detail
                      </Link>
                    </div>
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
