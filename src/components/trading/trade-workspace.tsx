"use client";

import { useState } from "react";
import { StockChart } from "@/components/market/stock-chart";
import { Ticket, type TicketDraft } from "./ticket";

/**
 * The ticket, with the chart of what it is trading beside it.
 *
 * The right-hand side used to hold only the order lists, mostly empty. A
 * limit price is a guess about where the share will trade, and the place to
 * make that guess is next to where it has traded: the chart follows the
 * ticket's symbol and draws the limit or stop being typed across it.
 */
export function TradeWorkspace({
  ticket,
  notMine,
  children,
}: {
  /** The ticket's settings, or null when the viewer cannot trade here. */
  ticket: Omit<React.ComponentProps<typeof Ticket>, "onDraft"> | null;
  /** Shown instead of the ticket to somebody else's viewer. */
  notMine: React.ReactNode;
  /** The order lists. */
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<TicketDraft | null>(null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      {ticket ? <Ticket {...ticket} onDraft={setDraft} /> : notMine}
      <div className="min-w-0 space-y-4">
        {ticket && draft && (
          <StockChart
            key={draft.symbol}
            symbol={draft.symbol}
            portfolioSlug={ticket.portfolioSlug}
            initialRange="1D"
            level={draft.level}
          />
        )}
        {children}
      </div>
    </div>
  );
}
