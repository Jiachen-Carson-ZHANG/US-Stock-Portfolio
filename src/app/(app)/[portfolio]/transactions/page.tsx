import { requirePortfolio } from "@/lib/portfolios/context";
import { getDb } from "@/lib/db";
import { realizedByFill } from "@/lib/portfolio/reconstruct";
import { Ledger, type LedgerEntry } from "@/components/transactions/ledger";
import { loadPortfolio, loadTransactions } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { EmptyState } from "@/components/ui/misc";
import { formatMoney } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { baseCurrency } from "@/lib/portfolio/service";

export const dynamic = "force-dynamic";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;


function usd(value: number, currency: string) {
  return formatMoney({ amount: String(value), currency });
}

export default async function TransactionsPage({
  params,
}: {
  params: Promise<{ portfolio: string }>;
}) {
  const { portfolio } = await requirePortfolio((await params).portfolio);
  const { t } = await serverDictionary();
  const currency = baseCurrency();

  const [{ transactions, totals }, { summary }] = await Promise.all([
    loadTransactions(portfolio.id),
    loadPortfolio(portfolio.id),
  ]);

  const realized = Number(summary.realizedPnL.amount);

  // Trades and transfers in one list. A ledger that leaves out the money
  // paid in is not the account's history, and the reconciliation banner
  // points people here to check exactly that.
  const db = await getDb();
  const flows = await db.all<{ id: string; date: string; amount: number; note: string }>(
    `SELECT id, date, amount, note FROM analysis_flows WHERE portfolio_id = ? ORDER BY date DESC`,
    [portfolio.id],
  );

  // Attributed on the fills in the order they happened, so the per-trade
  // figures sum to the totals shown above.
  const { byDeal } = realizedByFill([...transactions].reverse());

  const entries: LedgerEntry[] = [
    ...transactions.map((item) => ({
      id: item.dealId,
      date: item.tradedAt,
      kind: item.side,
      symbol: item.symbol,
      name: item.name ?? null,
      quantity: item.quantity,
      price: item.price,
      amount: item.amount,
      realized: byDeal.get(item.dealId) ?? null,
    })),
    ...flows.map((flow) => ({
      id: flow.id,
      date: flow.date,
      kind: (Number(flow.amount) >= 0 ? "deposit" : "withdrawal") as LedgerEntry["kind"],
      symbol: null,
      name: flow.note,
      quantity: null,
      price: null,
      amount: Number(flow.amount),
      realized: null,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const tiles = [
    {
      label: t.summary.realized,
      value: formatMoney(summary.realizedPnL, { signed: true }),
      tone: signClass(realized),
    },
    {
      label: t.transactions.tradeCount,
      value: String(totals.trades),
      tone: "text-foreground",
    },
    {
      label: t.transactions.buy,
      value: usd(totals.bought, currency),
      tone: "text-foreground",
    },
    {
      label: t.transactions.sell,
      value: usd(totals.sold, currency),
      tone: "text-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">
          {t.transactions.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.transactions.subtitle}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {tile.label}
            </p>
            <p className={`mt-2 text-xl font-semibold tracking-tight ${tile.tone}`}>
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title={t.transactions.none}
          description={t.transactions.noneHint}
        />
      ) : (
        <Ledger entries={entries} currency={currency} />
      )}
    </div>
  );
}
