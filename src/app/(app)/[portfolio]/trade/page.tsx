import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { serverDictionary } from "@/lib/i18n/server";
import { canWrite } from "@/lib/portfolios";
import { requirePortfolio } from "@/lib/portfolios/context";
import { baseCurrency } from "@/lib/portfolio/service";
import { buyingPower, recentOrders } from "@/lib/trading/orders";
import { OrderList, Ticket } from "@/components/trading/ticket";
import { Help } from "@/components/ui/help";
import { BackLink } from "@/components/ui/back-link";
import { OptionFinder } from "@/components/options/option-finder";

export const dynamic = "force-dynamic";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;


export default async function TradePage({
  params,
  searchParams,
}: {
  params: Promise<{ portfolio: string }>;
  /** Filled in by the option finder's "Trade this". */
  searchParams: Promise<{ symbol?: string; side?: string }>;
}) {
  const { user, portfolio } = await requirePortfolio((await params).portfolio);
  const wanted = await searchParams;
  const initialSymbol = /^[A-Z0-9.]{1,24}$/.test(wanted.symbol ?? "") ? wanted.symbol! : "";
  const initialSide = wanted.side === "sell" ? "sell" : "buy";
  const { t } = await serverDictionary();

  // A real brokerage account is traded in the broker's own app. This screen
  // exists for practice money, and pretending otherwise would be the worst
  // kind of confusion to build.
  if (portfolio.kind !== "mock") notFound();

  const db = await getDb();
  const mine = canWrite(user, portfolio);
  const [orders, power] = await Promise.all([
    recentOrders(db, portfolio.id),
    buyingPower(db, portfolio),
  ]);

  return (
    <div className="space-y-6">
      <BackLink href={`/${portfolio.slug}`} label={t.nav.overview} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-1.5 text-lg font-semibold tracking-tight">
            {portfolio.displayName} · {t.trade.title}
            <Help title={t.help.mock}>{t.help.mockBody}</Help>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.trade.subtitle}</p>
        </div>
        {mine && (
          <OptionFinder portfolioSlug={portfolio.slug} tradeSlug={portfolio.slug} />
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {mine ? (
          <Ticket
            // A new pre-filled symbol starts a fresh ticket rather than
            // editing whatever was half typed.
            key={`${initialSymbol}:${initialSide}`}
            initialSymbol={initialSymbol}
            initialSide={initialSide}
            portfolioSlug={portfolio.slug}
            currency={baseCurrency()}
            initialBuyingPower={power.toFixed(2)}
          />
        ) : (
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm text-muted-foreground">
              {t.mockTrade.onlyOwnerCanTradeGeneric}
            </p>
          </section>
        )}

        <OrderList
          portfolioSlug={portfolio.slug}
          orders={orders}
          canCancel={mine}
          currency={baseCurrency()}
        />
      </div>
    </div>
  );
}
