"use client";

import { Help } from "@/components/ui/help";
import { useLocale } from "@/lib/i18n/context";
import type { ExtendedSession, QuoteDetail } from "@/lib/market/detail";
import { cn, signClass } from "@/lib/utils";

const usd = (value: number | undefined, digits = 2) =>
  value === undefined
    ? undefined
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const compact = (value: number | undefined) =>
  value === undefined
    ? undefined
    : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
const pct = (value: number | undefined, signed = false) =>
  value === undefined ? undefined : `${signed && value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const fixed = (value: number | undefined, digits: number) =>
  value === undefined ? undefined : value.toFixed(digits);

type Row = { label: string; value: string | undefined; help?: string; tone?: string };

function Group({ title, rows, children }: { title: string; rows: Row[]; children?: React.ReactNode }) {
  const shown = rows.filter((row) => row.value !== undefined);
  if (shown.length === 0 && !children) return null;
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
      {shown.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {shown.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <span className="truncate">{row.label}</span>
                {row.help && <Help title={row.label}>{row.help}</Help>}
              </dt>
              <dd className={cn("tabular text-sm font-medium", row.tone)}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function hasRange(low?: number, high?: number, value?: number): boolean {
  return low !== undefined && high !== undefined && value !== undefined && high > low;
}

/** Where a price sits between two others, as a bar with a marker. */
function Range({ low, high, value, lowLabel, highLabel }: {
  low?: number;
  high?: number;
  value?: number;
  lowLabel: string;
  highLabel: string;
}) {
  if (low === undefined || high === undefined || value === undefined || !(high > low)) return null;
  const where = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return (
    <div className="mt-3">
      <div className="relative h-1.5 rounded-full bg-muted" aria-hidden="true">
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-foreground"
          style={{ left: `${where * 100}%` }}
        />
      </div>
      <p className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{lowLabel} <span className="tabular text-foreground">{usd(low)}</span></span>
        <span>{highLabel} <span className="tabular text-foreground">{usd(high)}</span></span>
      </p>
    </div>
  );
}

/**
 * Everything the broker publishes about a symbol, in small groups.
 *
 * It was one box of twenty-odd figures in equal type, which is tiring to scan
 * for the one you came for. Grouped by the question each answers — how is it
 * doing today, what would I pay, where is it in its year, what is the company
 * worth — each group a card of its own, with the day's and the year's range
 * drawn rather than listed. Anything the broker left blank is left out.
 */
export function MarketPanel({ detail, price }: { detail: QuoteDetail; price?: number }) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const now = price ?? detail.price;
  const spread =
    detail.bid !== undefined && detail.ask !== undefined && detail.ask >= detail.bid
      ? detail.ask - detail.bid
      : undefined;
  const option = detail.option;

  const session = (label: string, value: ExtendedSession | undefined): Row => ({
    label,
    value: value ? `${usd(value.price)} (${pct(value.changePercent, true)})` : undefined,
    tone: value ? signClass(value.changePercent) : undefined,
  });

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Group
        title={say("Today", "今日")}
        rows={[
          { label: say("Open", "今开"), value: usd(detail.open) },
          { label: say("Previous close", "昨收"), value: usd(detail.previousClose) },
          { label: say("Shares traded", "成交量"), value: compact(detail.volume) },
          { label: say("Money traded", "成交额"), value: detail.turnover === undefined ? undefined : `$${compact(detail.turnover)}` },
          {
            label: say("Average price", "均价"),
            value: usd(detail.averagePrice),
            help: say("The average price of every trade today, weighted by size.", "今天所有成交按成交量加权的平均价格。"),
          },
        ]}
      >
        {hasRange(detail.low, detail.high, now) && (
          <Range low={detail.low} high={detail.high} value={now} lowLabel={say("Today's low", "今日最低")} highLabel={say("High", "最高")} />
        )}
        {hasRange(detail.low52, detail.high52, now) && (
          <Range low={detail.low52} high={detail.high52} value={now} lowLabel={say("52-week low", "52周最低")} highLabel={say("High", "最高")} />
        )}
      </Group>

      <Group
        title={say("Buy and sell prices", "买卖报价")}
        rows={[
          {
            label: say("Bid", "买一"),
            value: detail.bid === undefined ? undefined : `${usd(detail.bid)}${detail.bidSize ? ` × ${compact(detail.bidSize)}` : ""}`,
            help: say(
              "The most a buyer is offering right now; selling at once gets about this. The number after × is how many shares are wanted at that price.",
              "此刻买方愿意出的最高价，马上卖出大约就是这个价。× 后面是在这个价位想买的股数。",
            ),
          },
          {
            label: say("Ask", "卖一"),
            value: detail.ask === undefined ? undefined : `${usd(detail.ask)}${detail.askSize ? ` × ${compact(detail.askSize)}` : ""}`,
            help: say(
              "The least a seller will take right now; buying at once costs about this.",
              "此刻卖方愿意接受的最低价，马上买入大约就是这个价。",
            ),
          },
          {
            label: say("Gap", "买卖价差"),
            value: spread === undefined ? undefined : usd(spread),
            help: say(
              "Ask minus bid, which is what trading straight away costs on top of the price. Smaller is better.",
              "卖一减买一，也就是立刻成交要额外付出的成本，越小越好。",
            ),
          },
        ]}
      />


      <Group
        title={say("Valuation", "估值")}
        rows={[
          { label: say("Market cap", "总市值"), value: detail.marketCap === undefined ? undefined : `$${compact(detail.marketCap)}` },
          {
            label: "P/E (TTM)",
            value: fixed(detail.peTtm, 2),
            help: say(
              "Price divided by the last twelve months' profit per share, which says how many years of today's profit the price pays for. Negative means the company lost money.",
              "股价除以过去十二个月的每股盈利，也就是股价相当于多少年的当前利润。为负表示公司在亏损。",
            ),
          },
          {
            label: "P/B",
            value: fixed(detail.pb, 2),
            help: say(
              "Price divided by the company's book value per share, which is what it owns less what it owes. Negative means it owes more than it owns.",
              "股价除以每股净资产（资产减负债）。为负表示负债超过资产。",
            ),
          },
          {
            label: "EPS",
            value: usd(detail.eps),
            help: say("Profit per share over the last twelve months.", "过去十二个月的每股盈利。"),
          },
          { label: say("Dividend yield", "股息率"), value: pct(detail.dividendYield) },
          { label: say("Shares out", "总股本"), value: compact(detail.sharesOutstanding) },
        ]}
      />

      <Group
        title={say("Activity", "活跃度")}
        rows={[
          {
            label: say("Turnover rate", "换手率"),
            value: pct(detail.turnoverRate),
            help: say("Shares traded today as a share of all shares available to trade.", "今天的成交股数占可流通股数的比例。"),
          },
          {
            label: say("Volume ratio", "量比"),
            value: fixed(detail.volumeRatio, 2),
            help: say(
              "Today's trading pace against the recent average. Above 1 is busier than usual.",
              "今天的成交节奏与近期平均的比较，大于 1 表示比平时活跃。",
            ),
          },
          {
            label: say("Day's range", "振幅"),
            value: pct(detail.amplitude),
            help: say("How far the price moved today, high to low, against yesterday's close.", "今天最高价与最低价之差，占昨收的比例。"),
          },
        ]}
      />

      {(detail.preMarket || detail.afterHours || detail.overnight) && (
        <Group
          title={say("Outside regular hours", "盘前盘后")}
          rows={[
            session(say("Pre-market", "盘前"), detail.preMarket),
            session(say("After hours", "盘后"), detail.afterHours),
            session(say("Overnight", "夜盘"), detail.overnight),
          ]}
        />
      )}

      {option && (
        <Group
          title={say("This contract", "合约信息")}
          rows={[
            { label: say("Type", "类型"), value: option.type === "put" ? say("Put", "看跌") : option.type === "call" ? say("Call", "看涨") : undefined },
            { label: say("Strike", "行权价"), value: usd(option.strike) },
            { label: say("Days left", "剩余天数"), value: option.daysToExpiry?.toFixed(0) },
            { label: say("Implied volatility", "隐含波动率"), value: option.impliedVolatility === undefined ? undefined : `${(option.impliedVolatility * 100).toFixed(1)}%` },
            { label: "Delta", value: fixed(option.delta, 3), help: say("How many shares one share's worth of the contract moves like.", "合约每一股相当于多少股正股的涨跌。") },
            { label: "Theta", value: fixed(option.theta, 3), tone: option.theta !== undefined && option.theta < 0 ? "text-negative" : undefined, help: say("Value lost per share each day if nothing else changes.", "如果其他条件不变，每股每天损失的价值。") },
            { label: "Gamma", value: fixed(option.gamma, 4) },
            { label: "Vega", value: fixed(option.vega, 3) },
            { label: say("Open interest", "未平仓"), value: compact(option.openInterest) },
            { label: say("Shares per contract", "每张股数"), value: option.multiplier ? String(option.multiplier) : undefined },
          ]}
        />
      )}
    </div>
  );
}
