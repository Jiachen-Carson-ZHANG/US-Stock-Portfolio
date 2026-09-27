"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { Help } from "@/components/ui/help";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { OptionExpiration } from "@/types/market";
import type { PositionView } from "@/types/portfolio";

type Contract = {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  bid?: number;
  ask?: number;
  last?: number;
  iv?: number;
  delta?: number;
  openInterest?: number;
  multiplier: number;
};

const WIDTHS = [
  { strikes: 12, en: "Near the price", zh: "现价附近" },
  { strikes: 30, en: "Wider", zh: "更宽" },
  { strikes: 150, en: "All strikes", zh: "全部" },
];

const num = (value: number | undefined, digits = 2) => (value === undefined ? "—" : value.toFixed(digits));

/**
 * The option chain, laid out the way moomoo lays it out.
 *
 * One expiry at a time; each strike on a row, the call on its left and the
 * put on its right, with the prices you would trade at (bid to sell, ask to
 * buy), how many shares each behaves like (delta), how expensive options are
 * (implied volatility) and how many are open. Contracts already worth
 * something if exercised now are shaded, and a line marks where the share is.
 * Tap a contract to see its payoff, trade it, or open its own page.
 */
export function ChainView({
  portfolioSlug,
  symbol,
  spot,
  expirations,
  tradeSlug,
}: {
  portfolioSlug: string;
  symbol: string;
  spot: number;
  expirations: OptionExpiration[];
  tradeSlug?: string | null;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const [expiry, setExpiry] = useState<string | null>(
    (expirations.find((row) => row.days >= 20) ?? expirations[0])?.date ?? null,
  );
  const [width, setWidth] = useState(12);
  const [side, setSide] = useState<"call" | "put">("call");
  const [chain, setChain] = useState<Contract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Contract | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!expiry) return;
      setChain(null);
      setError(null);
      void fetch(
        `/api/options/chain?portfolio=${encodeURIComponent(portfolioSlug)}&symbol=${encodeURIComponent(symbol)}&expiry=${expiry}&strikes=${width}`,
      )
        .then((response) => response.json())
        .then((body: { chain?: Contract[]; error?: string }) => {
          if (cancelled) return;
          if (body.error) setError(body.error);
          setChain(body.chain ?? []);
        })
        .catch(() => {
          if (!cancelled) setError(say("Could not reach the site.", "连不上网站。"));
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `say` is a label helper, not data
  }, [portfolioSlug, symbol, expiry, width]);

  const rows = chain
    ? [...new Set(chain.map((c) => c.strike))]
        .sort((a, b) => a - b)
        .map((strike) => ({
          strike,
          call: chain.find((c) => c.strike === strike && c.type === "call"),
          put: chain.find((c) => c.strike === strike && c.type === "put"),
        }))
    : [];
  const splitAt = rows.findIndex((row) => row.strike >= spot);

  const COLUMNS: (keyof Contract)[] = ["bid", "ask", "delta", "iv", "openInterest"];
  // On a phone one side is shown at a time, with bid, ask and delta; the rest
  // appear from tablet width up.
  const cells = (contract: Contract | undefined, inTheMoney: boolean, otherSide: boolean) =>
    COLUMNS.map((column, index) => (
      <td
        key={column}
        className={cn(
          "tabular px-2 py-2 text-right",
          (otherSide || index > 2) && "hidden md:table-cell",
          // A blue wash, as moomoo does: a grey one vanished against white.
          inTheMoney && "bg-(--chart-1)/8",
          contract && "cursor-pointer",
          // The chosen contract as one band across its cells; an outline on
          // each cell drew five separate boxes.
          picked && contract && picked.symbol === contract.symbol && "bg-(--chart-1)/20 font-semibold",
        )}
        onClick={() => contract && setPicked(contract)}
      >
        {contract === undefined
          ? ""
          : index === 0
            ? (
                // One real button per contract, so it can be chosen from the
                // keyboard; the rest of the row takes a click as well.
                <button
                  type="button"
                  className="w-full text-right"
                  aria-label={
                    contract.type === "call"
                      ? say(`Call at ${contract.strike}`, `行权价 ${contract.strike} 的看涨`)
                      : say(`Put at ${contract.strike}`, `行权价 ${contract.strike} 的看跌`)
                  }
                >
                  {num(contract.bid)}
                </button>
              )
          : column === "iv"
            ? contract.iv === undefined
              ? "—"
              : `${(contract.iv * 100).toFixed(0)}%`
            : column === "openInterest"
              ? contract.openInterest === undefined
                ? "—"
                : new Intl.NumberFormat("en-US", { notation: "compact" }).format(contract.openInterest)
              : num(contract[column] as number | undefined)}
      </td>
    ));

  const asPosition = (contract: Contract): PositionView[] =>
    [
      {
        id: contract.symbol,
        symbol: contract.symbol,
        instrumentType: "option",
        optionType: contract.type,
        strike: contract.strike,
        underlyingSymbol: symbol,
        expirationDate: contract.expiry,
        currency: "USD",
        quantity: 1,
        averageCost: contract.ask ?? contract.last ?? 0,
        currentPrice: contract.ask ?? contract.last,
        contractMultiplier: contract.multiplier,
      },
    ] as unknown as PositionView[];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{say("Expiry", "到期日")}</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {expirations.map((row) => (
            <button
              key={row.date}
              type="button"
              aria-pressed={expiry === row.date}
              onClick={() => {
                setExpiry(row.date);
                setPicked(null);
              }}
              className={cn(
                "min-h-9 shrink-0 rounded-lg border px-2.5 text-xs",
                expiry === row.date ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {row.date.slice(5)} · {row.days}
              {say("d", "天")}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label={say("Strikes shown", "显示的行权价")}>
          {WIDTHS.map((option) => (
            <button
              key={option.strikes}
              type="button"
              aria-pressed={width === option.strikes}
              onClick={() => setWidth(option.strikes)}
              className={cn("min-h-8 rounded-md px-2.5 text-xs", width === option.strikes ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted")}
            >
              {zh ? option.zh : option.en}
            </button>
          ))}
        </div>
        <div className="flex gap-1 md:hidden" role="group" aria-label={say("Calls or puts", "看涨或看跌")}>
          {(["call", "put"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={side === value}
              onClick={() => setSide(value)}
              className={cn("min-h-8 rounded-md px-3 text-xs", side === value ? "bg-muted font-medium" : "text-muted-foreground")}
            >
              {value === "call" ? say("Calls", "看涨") : say("Puts", "看跌")}
            </button>
          ))}
        </div>
        <Help title={say("Reading the chain", "怎么看期权链")}>
          {say(
            "Each row is a strike price. Calls are on the left, puts on the right. Bid is what you would get selling one now; ask is what buying one costs — per share, and a contract is 100 shares. Delta: how many shares one share's worth of the contract moves like (0.50 on a call moves about 50 cents for each dollar on the share). IV, implied volatility: how much movement the price assumes — higher means dearer. OI, open interest: how many contracts are open, a guide to how easy it is to trade. Shaded contracts would be worth something if exercised right now. Tap any contract for its payoff and to trade it.",
            "每一行是一个行权价，左边是看涨，右边是看跌。买一价是现在卖出能拿到的价格，卖一价是现在买入要付的价格——都是每股价格，一张合约是 100 股。Delta：合约每一股大约相当于多少股正股的涨跌（看涨 0.50 表示正股每涨 1 美元，它涨约 50 美分）。IV（隐含波动率）：价格里假设的波动幅度，越高越贵。OI（未平仓）：还持有着的合约数量，可以看出好不好成交。带阴影的合约如果现在行权就有价值。点任意合约可以看盈亏图并交易。",
          )}
        </Help>
      </div>

      {error ? (
        <p className="text-sm text-negative">{error}</p>
      ) : chain === null ? (
        <p className="text-sm text-muted-foreground">{say("Pricing the chain…", "正在给期权链报价…")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{say("No contracts with prices on this date.", "这一天没有带报价的合约。")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th colSpan={5} className="hidden px-2 py-1.5 text-left font-medium md:table-cell">{say("Calls", "看涨")}</th>
                <th className="px-2 py-1.5 font-medium" />
                <th colSpan={5} className="hidden px-2 py-1.5 text-right font-medium md:table-cell">{say("Puts", "看跌")}</th>
              </tr>
              <tr>
                {["Bid", "Ask", "Δ", "IV", "OI"].map((label) => (
                  <th key={`c${label}`} className={cn("px-2 py-1.5 text-right font-normal", side === "put" && "hidden md:table-cell", label !== "Bid" && label !== "Ask" && label !== "Δ" && "hidden md:table-cell")}>
                    {label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center font-medium text-foreground">{say("Strike", "行权价")}</th>
                {["Bid", "Ask", "Δ", "IV", "OI"].map((label) => (
                  <th key={`p${label}`} className={cn("px-2 py-1.5 text-right font-normal", side === "call" && "hidden md:table-cell", label !== "Bid" && label !== "Ask" && label !== "Δ" && "hidden md:table-cell")}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Fragment key={row.strike}>
                  {index === splitAt && (
                    <tr>
                      <td colSpan={11} className="border-y border-accent bg-accent/5 px-2 py-1 text-center text-[11px] font-medium">
                        {symbol} ${spot.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-border last:border-0">
                    {cells(row.call, row.strike < spot, side === "put")}
                    <td className="tabular px-2 py-2 text-center font-medium">{row.strike}</td>
                    {cells(row.put, row.strike > spot, side === "call")}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">
                {symbol} {picked.strike} {picked.type === "call" ? say("call", "看涨") : say("put", "看跌")} · {picked.expiry}
              </p>
              <p className="tabular text-xs text-muted-foreground">
                {say("Bid", "买一")} {num(picked.bid)} · {say("Ask", "卖一")} {num(picked.ask)} · {say("Last", "最新")} {num(picked.last)}
                {picked.ask !== undefined &&
                  ` · ${say("Break-even if bought", "买入保本价")} $${(picked.type === "call" ? picked.strike + picked.ask : picked.strike - picked.ask).toFixed(2)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link href={`/${portfolioSlug}/holdings/${encodeURIComponent(picked.symbol)}`} className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 hover:bg-muted">
                {say("Contract page", "合约详情")}
              </Link>
              {tradeSlug && (
                <Link
                  href={`/${tradeSlug}/trade?symbol=${encodeURIComponent(picked.symbol)}`}
                  className="inline-flex min-h-9 items-center rounded-lg bg-foreground px-3 font-medium text-background hover:opacity-90"
                >
                  {say("Trade in practice", "模拟交易")}
                </Link>
              )}
            </div>
          </div>
          <PayoffExplorer positions={asPosition(picked)} underlyingPrices={{ [symbol]: spot }} hypothetical />
        </section>
      )}
    </div>
  );
}
