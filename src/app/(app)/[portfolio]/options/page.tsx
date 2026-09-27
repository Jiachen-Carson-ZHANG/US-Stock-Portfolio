import { getDb } from "@/lib/db";
import { serverDictionary } from "@/lib/i18n/server";
import { visibleTo } from "@/lib/portfolios";
import { requirePortfolio } from "@/lib/portfolios/context";
import { loadPortfolio } from "@/lib/portfolio/service";
import { OptionsWorkbench } from "@/components/options/options-workbench";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function OptionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ portfolio: string }>;
  searchParams: Promise<{ symbol?: string; tab?: string }>;
}) {
  const { user, portfolio } = await requirePortfolio((await params).portfolio);
  const wanted = await searchParams;
  const db = await getDb();
  const [{ t }, visible, data] = await Promise.all([
    serverDictionary(),
    visibleTo(db, user),
    loadPortfolio(portfolio.id).catch(() => null),
  ]);

  // Where "Trade in practice" goes: the viewer's own practice account.
  const practice = visible.find((p) => p.kind === "mock" && p.ownerUserId === user.id);
  // Start from what the page was asked for, else the first share this
  // account holds options on.
  const symbol = /^[A-Z][A-Z0-9.]{0,9}$/.test(wanted.symbol ?? "")
    ? wanted.symbol!
    : (data?.optionGroups[0]?.underlying ?? "");
  const zh = t.nav.overview === "总览";

  return (
    <div className="space-y-5">
      <BackLink href={`/${portfolio.slug}`} label={t.nav.overview} />
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{zh ? "期权" : "Options"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {zh
            ? "查看一只股票的期权链，或按你的目标搜索合适的交易。"
            : "Look through a share's option chain, or search it for trades that fit what you want."}
        </p>
      </header>
      <OptionsWorkbench
        portfolioSlug={portfolio.slug}
        initialSymbol={symbol}
        initialTab={wanted.tab === "finder" ? "finder" : "chain"}
        tradeSlug={practice?.slug ?? null}
      />
    </div>
  );
}
