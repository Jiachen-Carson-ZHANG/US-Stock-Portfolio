"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { cn, signClass } from "@/lib/utils";

export type LedgerEntry = {
  id: string;
  date: string;
  kind: "buy" | "sell" | "deposit" | "withdrawal";
  symbol: string | null;
  name: string | null;
  quantity: number | null;
  price: number | null;
  /** Signed cash effect: negative when money leaves. */
  amount: number;
  /** Profit taken on this sale, when it closed something. */
  realized: number | null;
};

const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  buy: "Buy",
  sell: "Sell",
  deposit: "Paid in",
  withdrawal: "Withdrawn",
};

type Filter = "all" | "trades" | "transfers";

/**
 * Everything that moved cash, in one list.
 *
 * Trades alone are not the account's history: a page called "transactions"
 * that omits the money paid in tells a misleading story, and the two are
 * only comparable side by side. Transfers are labelled differently so
 * nobody reads a deposit as a profit.
 */
export function Ledger({
  entries,
  currency,
}: {
  entries: LedgerEntry[];
  currency: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const term = query.trim().toUpperCase();
    return entries.filter((entry) => {
      const isTrade = entry.kind === "buy" || entry.kind === "sell";
      if (filter === "trades" && !isTrade) return false;
      if (filter === "transfers" && isTrade) return false;
      if (!term) return true;
      return (entry.symbol ?? "").toUpperCase().includes(term);
    });
  }, [entries, filter, query]);

  const money = (value: number) =>
    formatMoney({ amount: String(value), currency }, { signed: true });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "trades", "transfers"] as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            aria-pressed={filter === option}
            className={cn(
              "min-h-9 rounded-lg px-3 text-sm capitalize transition-colors",
              filter === option
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option}
          </button>
        ))}

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by symbol"
          aria-label="Filter by symbol"
          className="ml-auto min-h-9 w-40 rounded-lg border border-border bg-background px-3 text-sm"
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing matches that.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Every trade and transfer</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="px-4 py-3 text-left font-medium">Date</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">What</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Qty</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Price</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Cash</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => {
                const transfer = entry.kind === "deposit" || entry.kind === "withdrawal";
                return (
                  <tr key={entry.id} className="border-b border-border last:border-0">
                    <td className="tabular px-4 py-3 text-muted-foreground">
                      {entry.date.slice(0, 10)}
                    </td>
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      <span
                        className={cn(
                          "mr-2 text-xs font-normal",
                          transfer
                            ? "text-muted-foreground"
                            : entry.kind === "buy"
                              ? "text-positive"
                              : "text-negative",
                        )}
                      >
                        {KIND_LABEL[entry.kind]}
                      </span>
                      {entry.symbol ?? (
                        <span className="font-normal text-muted-foreground">
                          {entry.name ?? "Bank transfer"}
                        </span>
                      )}
                    </th>
                    <td className="tabular px-4 py-3 text-right">
                      {entry.quantity ?? "—"}
                    </td>
                    <td className="tabular px-4 py-3 text-right">
                      {entry.price === null
                        ? "—"
                        : formatMoney({ amount: String(entry.price), currency })}
                    </td>
                    <td className={cn("tabular px-4 py-3 text-right", signClass(entry.amount))}>
                      {money(entry.amount)}
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-3 text-right",
                        entry.realized === null ? "" : signClass(entry.realized),
                      )}
                    >
                      {entry.realized === null ? "—" : money(entry.realized)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Result is the profit taken on a sale, against the average cost of what
        it closed. A purchase realizes nothing, and a transfer is not a gain.
      </p>
    </div>
  );
}
