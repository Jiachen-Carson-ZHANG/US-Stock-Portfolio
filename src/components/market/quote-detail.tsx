"use client";

import { useLocale } from "@/lib/i18n/context";
import { cn, signClass } from "@/lib/utils";
import type { ExtendedSession, QuoteDetail } from "@/lib/market/detail";

function money(value: number | undefined, digits = 2): string | undefined {
  if (value === undefined) return undefined;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function compact(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function pct(value: number | undefined, signed = false): string | undefined {
  if (value === undefined) return undefined;
  return `${signed && value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fixed(value: number | undefined, digits: number): string | undefined {
  return value === undefined ? undefined : value.toFixed(digits);
}

type Cell = { label: string; value: string | undefined; tone?: string };

/**
 * Every figure the broker publishes about a symbol, the way a trading app
 * lays them out: a dense grid, grouped, with anything the broker left blank
 * simply absent rather than shown as a zero that means nothing.
 */
export function QuoteDetailPanel({ detail, compactView = false }: { detail: QuoteDetail; compactView?: boolean }) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);

  const grid = (cells: Cell[]) => {
    const shown = cells.filter((cell) => cell.value !== undefined);
    if (shown.length === 0) return null;
    return (
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-x-3 sm:gap-y-2">
        {shown.map((cell) => (
          <div key={cell.label} className="min-w-0 rounded-lg bg-muted/40 px-3 py-2.5 sm:rounded-none sm:bg-transparent sm:p-0">
            <dt className="text-[11px] text-muted-foreground sm:truncate">{cell.label}</dt>
            <dd className={cn("tabular mt-1 break-words text-sm font-medium sm:mt-0 sm:truncate sm:text-xs", cell.tone)}>{cell.value}</dd>
          </div>
        ))}
      </dl>
    );
  };

  const session = (label: string, value: ExtendedSession | undefined) =>
    value && (
      <span className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-baseline gap-2 py-2 text-xs sm:inline-flex sm:gap-1.5 sm:py-0">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-medium">{money(value.price)}</span>
        <span className={cn("tabular text-right sm:text-left", signClass(value.changePercent))}>
          {pct(value.changePercent, true)}
        </span>
      </span>
    );

  const option = detail.option;

  return (
    <div className="space-y-3">
      {/* Outside the regular session, what it has done since — the number
          people most often go looking for first thing in the morning. */}
      {(detail.preMarket || detail.afterHours || detail.overnight) && (
        <div className="divide-y divide-border rounded-lg border border-border px-3 sm:flex sm:flex-wrap sm:gap-x-4 sm:gap-y-1 sm:divide-y-0 sm:rounded-none sm:border-0 sm:px-0">
          {session(say("Pre-market", "盘前"), detail.preMarket)}
          {session(say("After hours", "盘后"), detail.afterHours)}
          {session(say("Overnight", "夜盘"), detail.overnight)}
        </div>
      )}

      {option &&
        grid([
          { label: say("Type", "类型"), value: option.type === "put" ? say("Put", "看跌") : option.type === "call" ? say("Call", "看涨") : undefined },
          { label: say("Strike", "行权价"), value: money(option.strike) },
          { label: say("Days left", "剩余天数"), value: option.daysToExpiry?.toFixed(0) },
          { label: say("Implied vol", "隐含波动率"), value: option.impliedVolatility === undefined ? undefined : `${(option.impliedVolatility * 100).toFixed(1)}%` },
          { label: "Delta", value: fixed(option.delta, 3) },
          { label: "Gamma", value: fixed(option.gamma, 4) },
          { label: "Theta", value: fixed(option.theta, 3), tone: option.theta !== undefined && option.theta < 0 ? "text-negative" : undefined },
          { label: "Vega", value: fixed(option.vega, 3) },
          { label: "Rho", value: fixed(option.rho, 3) },
          { label: say("Open interest", "未平仓"), value: compact(option.openInterest) },
          { label: say("Per contract", "每张合约"), value: option.multiplier ? `×${option.multiplier}` : undefined },
          { label: say("Style", "行权方式"), value: option.style === "AMERICAN" ? say("American", "美式") : option.style === "EUROPEAN" ? say("European", "欧式") : option.style },
        ])}

      {grid([
        { label: say("Open", "今开"), value: money(detail.open) },
        { label: say("Prev close", "昨收"), value: money(detail.previousClose) },
        { label: say("High", "最高"), value: money(detail.high) },
        { label: say("Low", "最低"), value: money(detail.low) },
        { label: say("Bid", "买一"), value: detail.bid === undefined ? undefined : `${money(detail.bid)}${detail.bidSize ? ` ×${compact(detail.bidSize)}` : ""}` },
        { label: say("Ask", "卖一"), value: detail.ask === undefined ? undefined : `${money(detail.ask)}${detail.askSize ? ` ×${compact(detail.askSize)}` : ""}` },
        { label: say("Volume", "成交量"), value: compact(detail.volume) },
        { label: say("Turnover", "成交额"), value: detail.turnover === undefined ? undefined : `$${compact(detail.turnover)}` },
        ...(compactView
          ? []
          : [
              { label: say("52w high", "52周最高"), value: money(detail.high52) },
              { label: say("52w low", "52周最低"), value: money(detail.low52) },
              { label: say("Average", "均价"), value: money(detail.averagePrice) },
              { label: say("Range", "振幅"), value: pct(detail.amplitude) },
              { label: say("Turnover rate", "换手率"), value: pct(detail.turnoverRate) },
              { label: say("Volume ratio", "量比"), value: fixed(detail.volumeRatio, 2) },
              { label: say("Market cap", "总市值"), value: detail.marketCap === undefined ? undefined : `$${compact(detail.marketCap)}` },
              { label: say("P/E (TTM)", "市盈率TTM"), value: fixed(detail.peTtm, 2) },
              { label: say("P/B", "市净率"), value: fixed(detail.pb, 2) },
              { label: "EPS", value: money(detail.eps) },
              { label: say("Dividend yield", "股息率TTM"), value: pct(detail.dividendYield) },
              { label: say("Shares out", "流通股"), value: compact(detail.sharesOutstanding) },
            ]),
      ])}
    </div>
  );
}
