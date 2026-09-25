"use client";

import { Help } from "@/components/ui/help";
import { useLocale } from "@/lib/i18n/context";
import { quoteDetail } from "@/lib/market/detail";
import { cn, signClass } from "@/lib/utils";
import type { MarketSession } from "@/types/market";

export type CardQuote = {
  symbol: string;
  price: number;
  previousClose?: number;
  changePercent: number;
  name?: string;
  raw?: Record<string, unknown>;
};

const usd = (value: number | undefined) =>
  value === undefined
    ? "—"
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (value: number | undefined) =>
  value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/**
 * The quote on the order ticket, laid out for deciding.
 *
 * It was a line of price and name followed by a grid of a dozen figures in
 * equal type — pre-market, after hours and overnight among them — and the
 * two numbers an order actually turns on were somewhere in the middle. Now:
 * the price and the day's move, large; outside regular hours, the price it is
 * really trading at, since the headline is the last close; then bid and ask,
 * which is what a buyer pays and a seller gets; then where today sits in the
 * day's range. The rest is still on the symbol's own page.
 */
export function QuoteCard({ quote, session }: { quote: CardQuote; session: MarketSession }) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const detail = quoteDetail(quote.symbol, quote.raw);
  const name = (zh && detail.nameZh) || quote.name || detail.name;
  const change =
    quote.previousClose !== undefined ? quote.price - quote.previousClose : undefined;

  // Outside the regular session the headline price is yesterday's close; the
  // extended-hours print is the live one, so it gets its own line.
  const live =
    session === "pre-market"
      ? { label: say("Pre-market", "盘前"), value: detail.preMarket }
      : session === "after-hours"
        ? { label: say("After hours", "盘后"), value: detail.afterHours }
        : session === "closed"
          ? detail.overnight
            ? { label: say("Overnight", "夜盘"), value: detail.overnight }
            : { label: say("After hours", "盘后"), value: detail.afterHours }
          : null;

  const low = detail.low;
  const high = detail.high;
  const where =
    low !== undefined && high !== undefined && high > low
      ? Math.min(1, Math.max(0, (quote.price - low) / (high - low)))
      : null;
  const option = detail.option;

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{quote.symbol}</span>
          {name && <span className="truncate text-xs text-muted-foreground">{name}</span>}
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="tabular text-2xl font-semibold tracking-tight">{usd(quote.price)}</span>
          <span className={cn("tabular text-sm", signClass(quote.changePercent))}>
            {change !== undefined && `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(2)} `}(
            {quote.changePercent >= 0 ? "+" : ""}
            {quote.changePercent.toFixed(2)}%)
          </span>
          {session !== "regular" && (
            <span className="text-xs text-muted-foreground">{say("at the last close", "上一收盘")}</span>
          )}
        </p>
        {live?.value && (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">{live.label}</span>
            <span className="tabular font-medium">{usd(live.value.price)}</span>
            <span className={cn("tabular text-xs", signClass(live.value.changePercent))}>
              {live.value.changePercent >= 0 ? "+" : ""}
              {live.value.changePercent.toFixed(2)}%
            </span>
          </p>
        )}
      </div>

      {(detail.bid !== undefined || detail.ask !== undefined) && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="flex items-center gap-0.5 text-xs text-muted-foreground">
              {say("Bid", "买一")}
              <Help title={say("Bid and ask", "买一与卖一")}>
                {say(
                  "The bid is the most a buyer is offering right now; the ask is the least a seller will take. Buying at a real broker costs about the ask, selling brings about the bid, and the gap between them is the cost of trading at once. The number after × is how many shares are offered at that price.",
                  "买一是此刻买方愿意出的最高价，卖一是卖方愿意接受的最低价。在真实券商立刻买入大约按卖一成交，卖出大约按买一成交，两者之差就是马上成交的成本。× 后面是在这个价位挂着的股数。",
                )}
              </Help>
            </dt>
            <dd className="tabular font-medium">
              {usd(detail.bid)}
              {detail.bidSize ? (
                <span className="text-xs text-muted-foreground"> ×{compact(detail.bidSize)}</span>
              ) : null}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{say("Ask", "卖一")}</dt>
            <dd className="tabular font-medium">
              {usd(detail.ask)}
              {detail.askSize ? (
                <span className="text-xs text-muted-foreground"> ×{compact(detail.askSize)}</span>
              ) : null}
            </dd>
          </div>
        </dl>
      )}

      {where !== null && (
        <div>
          <p className="flex justify-between text-xs text-muted-foreground">
            <span>{say("Day's low", "今日最低")} <span className="tabular text-foreground">{usd(low)}</span></span>
            <span>{say("Day's high", "今日最高")} <span className="tabular text-foreground">{usd(high)}</span></span>
          </p>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-muted" aria-hidden="true">
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-foreground"
              style={{ left: `${where * 100}%` }}
            />
          </div>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">{say("Open", "今开")}</dt>
          <dd className="tabular font-medium">{usd(detail.open)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{say("Prev close", "昨收")}</dt>
          <dd className="tabular font-medium">{usd(detail.previousClose ?? quote.previousClose)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{say("Volume", "成交量")}</dt>
          <dd className="tabular font-medium">{compact(detail.volume)}</dd>
        </div>
      </dl>

      {option && (
        <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{say("Contract", "合约")}</dt>
            <dd className="font-medium">
              {option.type === "put" ? say("Put", "看跌") : say("Call", "看涨")} {usd(option.strike)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{say("Days left", "剩余天数")}</dt>
            <dd className="tabular font-medium">{option.daysToExpiry?.toFixed(0) ?? "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-0.5 text-muted-foreground">
              {say("Moves like", "相当于")}
              <Help title={say("Delta", "Delta")} align="right">
                {say(
                  "How many shares one contract behaves like today: a delta of 0.60 on a contract of 100 shares moves about $60 for each dollar the share moves. It changes as the share moves and as expiry nears.",
                  "一张合约今天大约相当于多少股：Delta 为 0.60、每张 100 股的合约，正股每动 1 美元，它大约动 60 美元。它会随股价和到期日临近而变化。",
                )}
              </Help>
            </dt>
            <dd className="tabular font-medium">
              {option.delta === undefined
                ? "—"
                : `${Math.round(option.delta * (option.multiplier ?? 100))} ${say("shares", "股")}`}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-0.5 text-muted-foreground">
              {say("Per day", "每天损耗")}
              <Help title={say("Theta", "Theta")}>
                {say(
                  "What one contract loses in value each day if nothing else changes — the cost of waiting when you own an option. Shown for a whole contract.",
                  "如果其他条件不变，一张合约每天会损失多少价值——持有期权时「等待」的成本。按整张合约计算。",
                )}
              </Help>
            </dt>
            <dd className={cn("tabular font-medium", option.theta !== undefined && option.theta < 0 && "text-negative")}>
              {option.theta === undefined
                ? "—"
                : `${option.theta < 0 ? "−" : "+"}${usd(Math.abs(option.theta * (option.multiplier ?? 100)))}`}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-0.5 text-muted-foreground">
              {say("Implied vol", "隐含波动率")}
              <Help title={say("Implied volatility", "隐含波动率")}>
                {say(
                  "How much the market expects the share to swing over a year, read back out of this contract's price. Higher means the contract is more expensive for the same strike and date.",
                  "从这张合约的价格反推出来的、市场预期正股一年内的波动幅度。越高说明同样行权价和到期日的合约越贵。",
                )}
              </Help>
            </dt>
            <dd className="tabular font-medium">
              {option.impliedVolatility === undefined
                ? "—"
                : `${(option.impliedVolatility * 100).toFixed(1)}%`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{say("Open interest", "未平仓")}</dt>
            <dd className="tabular font-medium">{compact(option.openInterest)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
