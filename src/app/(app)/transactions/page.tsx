import { requireUser } from "@/lib/auth/guards";
import { loadPortfolio, loadTransactions } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { EmptyState } from "@/components/ui/misc";
import { formatMoney } from "@/lib/money";
import { signClass } from "@/lib/utils";
import { baseCurrency } from "@/lib/portfolio/service";

export const dynamic = "force-dynamic";

function usd(value: number, currency: string) {
  return formatMoney({ amount: String(value), currency });
}

export default async function TransactionsPage() {
  await requireUser();
  const { t } = await serverDictionary();
  const currency = baseCurrency();

  const [{ transactions, totals }, { summary }] = await Promise.all([
    loadTransactions(),
    loadPortfolio(),
  ]);

  const realized = Number(summary.realizedPnL.amount);

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

      {transactions.length === 0 ? (
        <EmptyState
          title={t.transactions.none}
          description={t.transactions.noneHint}
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t.transactions.title}</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-3 text-left font-medium">{t.transactions.date}</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">{t.transactions.symbol}</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">{t.transactions.side}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t.transactions.qty}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t.transactions.price}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t.transactions.amount}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((item) => (
                  <tr key={item.dealId} className="border-b border-border last:border-0">
                    <td className="tabular px-4 py-3 text-muted-foreground">
                      {new Date(item.tradedAt).toLocaleDateString()}
                    </td>
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      {item.symbol}
                      {item.name && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {item.name}
                        </span>
                      )}
                    </th>
                    <td
                      className={`px-4 py-3 ${item.side === "buy" ? "text-positive" : "text-negative"}`}
                    >
                      {item.side === "buy" ? t.transactions.buy : t.transactions.sell}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{item.quantity}</td>
                    <td className="tabular px-4 py-3 text-right">
                      {usd(item.price, currency)}
                    </td>
                    <td className={`tabular px-4 py-3 text-right ${signClass(item.amount)}`}>
                      {formatMoney({ amount: String(item.amount), currency }, { signed: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 lg:hidden">
            {transactions.map((item) => (
              <li
                key={item.dealId}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    <span
                      className={item.side === "buy" ? "text-positive" : "text-negative"}
                    >
                      {item.side === "buy" ? t.transactions.buy : t.transactions.sell}
                    </span>
                    {" · "}
                    {item.quantity} @ {usd(item.price, currency)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`tabular text-sm font-medium ${signClass(item.amount)}`}>
                    {formatMoney({ amount: String(item.amount), currency }, { signed: true })}
                  </p>
                  <p className="tabular text-xs text-muted-foreground">
                    {new Date(item.tradedAt).toLocaleDateString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
