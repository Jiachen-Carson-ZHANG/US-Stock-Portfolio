"use client";

import { useEffect, useId, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK, GRID, Tip, exactUsd, makeCurrencyTick, seriesColor } from "@/components/charts/chart-kit";
import { Help } from "@/components/ui/help";
import { useLocale } from "@/lib/i18n/context";
import { CHART_RANGES, type ChartRange } from "@/lib/market/chart-range";
import { tradedByPrice } from "@/lib/market/traded-by-price";
import { cn, signClass } from "@/lib/utils";
import type { BarInterval, HistoricalPrice } from "@/types/market";

const VOLUME = "var(--chart-other)";
const UP = "var(--positive)";
const DOWN = "var(--negative)";

const RANGE_LABEL: Record<ChartRange, { en: string; zh: string }> = {
  "1D": { en: "1D", zh: "1日" },
  "1W": { en: "1W", zh: "1周" },
  "1M": { en: "1M", zh: "1月" },
  "1Y": { en: "1Y", zh: "1年" },
  MAX: { en: "Max", zh: "全部" },
};

const CANDLE_LABEL: Record<BarInterval, { en: string; zh: string }> = {
  "5m": { en: "each candle: 5 minutes", zh: "每根K线：5分钟" },
  "30m": { en: "each candle: 30 minutes", zh: "每根K线：30分钟" },
  day: { en: "each candle: a day", zh: "每根K线：1天" },
  week: { en: "each candle: a week", zh: "每根K线：1周" },
  month: { en: "each candle: a month", zh: "每根K线：1个月" },
};

type Loaded = { interval: BarInterval; bars: HistoricalPrice[] };
type Candle = HistoricalPrice & {
  key: string;
  span: [number, number];
  traded?: number;
  change?: number;
};

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/** A bar's time in New York, where the market keeps its hours. */
function nyTime(iso: string, withDay: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    ...(withDay ? { month: "numeric", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function tickFor(interval: BarInterval) {
  return (key: string) => {
    if (interval === "5m") return nyTime(key, false);
    if (interval === "30m") return nyTime(key, true).split(",")[0];
    const [year, month, day] = key.split("-");
    if (interval === "month") return `${month}/${year.slice(2)}`;
    return `${Number(month)}/${Number(day)}`;
  };
}

/**
 * One candle: a thin line from the low to the high, and a body from the open
 * to the close. Rising candles are hollow and falling ones filled, as on a
 * trading screen, so the direction does not rest on red and green alone.
 *
 * Drawn as a custom shape over a bar that spans the low to the high: the bar
 * gives the pixels for those two, and the open and close sit in between.
 */
function CandleShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Candle }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const close = payload.close;
  const open = payload.open ?? close;
  const high = Math.max(payload.high ?? close, open, close);
  const low = Math.min(payload.low ?? close, open, close);
  const span = high - low;
  const at = (value: number) => (span > 0 ? y + ((high - value) / span) * height : y + height / 2);
  const up = close >= open;
  const color = up ? UP : DOWN;
  const middle = x + width / 2;
  const body = Math.max(1, Math.min(width * 0.72, 14));
  const top = at(Math.max(open, close));
  return (
    <g>
      <line x1={middle} x2={middle} y1={at(high)} y2={at(low)} stroke={color} strokeWidth={1} />
      <rect
        x={middle - body / 2}
        y={top}
        width={body}
        height={Math.max(1, at(Math.min(open, close)) - top)}
        fill={up ? "var(--surface)" : color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

/**
 * A price chart in candles, with what traded under it and where.
 *
 * Replaced a line of closing prices. A close says where the day ended and
 * nothing about the path: whether it touched a limit you are thinking of,
 * how far it swung. Each candle carries the open, the high, the low and the
 * close of its period, and the range picks the period — five minutes for a
 * day, half an hour for a week, a day for a month, a week for a year, a month
 * for everything.
 *
 * Price and money traded are two charts on one time axis rather than two
 * scales on one chart. Beside them, the price bands where most of the
 * period's money changed hands.
 */
export function StockChart({
  symbol,
  portfolioSlug,
  initialRange = "1M",
  initial,
  averageCost,
  level,
  className,
}: {
  symbol: string;
  /** Whose connection pays for the prices. */
  portfolioSlug: string;
  initialRange?: ChartRange;
  /** Candles already loaded for the first range, so it draws at once. */
  initial?: Loaded;
  /** What you paid per share, if you hold it, drawn across the price. */
  averageCost?: number;
  /** A price being typed into an order, drawn across the chart. */
  level?: { price: number; label: string } | null;
  className?: string;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const sync = useId();
  const [range, setRange] = useState<ChartRange>(initialRange);
  const [loaded, setLoaded] = useState<Partial<Record<ChartRange, Loaded | "failed">>>(
    initial ? { [initialRange]: initial } : {},
  );

  const current = loaded[range];
  useEffect(() => {
    if (current !== undefined) return;
    let cancelled = false;
    void fetch(
      `/api/market/history/${encodeURIComponent(symbol)}?portfolio=${encodeURIComponent(portfolioSlug)}&range=${range}`,
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { interval?: BarInterval; bars?: HistoricalPrice[] } | null) => {
        if (cancelled) return;
        setLoaded((before) => ({
          ...before,
          [range]: body?.bars && body.interval ? { interval: body.interval, bars: body.bars } : "failed",
        }));
      })
      .catch(() => {
        if (!cancelled) setLoaded((before) => ({ ...before, [range]: "failed" }));
      });
    return () => {
      cancelled = true;
    };
  }, [current, range, symbol, portfolioSlug]);

  const shown = current && current !== "failed" ? current : null;
  const candles: Candle[] = (shown?.bars ?? []).map((bar, index, all) => {
    const low = Math.min(bar.low ?? bar.close, bar.open ?? bar.close, bar.close);
    const high = Math.max(bar.high ?? bar.close, bar.open ?? bar.close, bar.close);
    const previous = all[index - 1]?.close;
    return {
      ...bar,
      key: bar.time ?? bar.date,
      span: [low, high],
      traded: bar.turnover ?? (bar.volume !== undefined ? bar.volume * bar.close : undefined),
      change: previous ? ((bar.close - previous) / previous) * 100 : undefined,
    };
  });

  const hasVolume = candles.some((candle) => candle.traded !== undefined && candle.traded > 0);
  const last = candles[candles.length - 1];
  const first = candles[0];
  const moved = first && last ? ((last.close - (first.open ?? first.close)) / (first.open ?? first.close)) * 100 : null;
  const bands = hasVolume ? tradedByPrice(candles, 10).reverse() : [];
  const busiest = Math.max(0, ...bands.map((band) => band.traded));

  const marks = [averageCost, level?.price].filter((value): value is number => value !== undefined && value > 0);
  const lows = [...candles.map((candle) => candle.span[0]), ...marks];
  const highs = [...candles.map((candle) => candle.span[1]), ...marks];
  const low = lows.length ? Math.min(...lows) : 0;
  const high = highs.length ? Math.max(...highs) : 1;
  const pad = (high - low) * 0.06 || high * 0.02 || 1;
  const priceTick = makeCurrencyTick(low, high);
  const xTick = tickFor(shown?.interval ?? "day");

  const tooltipLabel = (candle: Candle) =>
    candle.time
      ? `${candle.date} ${nyTime(candle.time, false)} ET`
      : shown?.interval === "week"
        ? say(`Week of ${candle.date}`, `${candle.date} 当周`)
        : shown?.interval === "month"
          ? candle.date.slice(0, 7)
          : candle.date;

  return (
    <section className={cn("rounded-xl border border-border bg-surface p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {say("Price and trading", "价格与成交")}
            <Help title={say("Reading the candles", "怎么看K线")}>
              {say(
                "Each candle is one period — the range buttons pick how long. The thin line runs from the lowest to the highest price in that period; the box from where it opened to where it closed. A hollow box closed higher than it opened, a filled one lower. Under the price: how much money changed hands in each period. Beside it: the price bands where most of that money traded — prices where a lot changed hands tend to matter again. Dashed lines mark what you paid, or the price you are typing into an order.",
                "每根K线代表一个时段，时长由上方按钮决定。细线从该时段的最低价连到最高价；方框从开盘价到收盘价。空心表示收盘高于开盘，实心表示收盘低于开盘。价格下方是每个时段的成交金额；右侧是这段时间成交最集中的价格区间——成交特别多的价位往往会再次起作用。虚线是你的买入均价，或你正在下单填写的价格。",
              )}
            </Help>
          </h2>
          {shown && (
            <p className="mt-1 text-xs text-muted-foreground">
              {zh ? CANDLE_LABEL[shown.interval].zh : CANDLE_LABEL[shown.interval].en}
              {moved !== null && (
                <>
                  {" · "}
                  <span className={cn("tabular font-medium", signClass(moved))}>
                    {moved >= 0 ? "+" : ""}
                    {moved.toFixed(2)}%
                  </span>{" "}
                  {say("over the range", "区间涨跌")}
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-1" role="group" aria-label={say("Range", "区间")}>
          {CHART_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
              className={cn(
                "min-h-8 rounded-md px-2.5 text-xs",
                range === option ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {zh ? RANGE_LABEL[option].zh : RANGE_LABEL[option].en}
            </button>
          ))}
        </div>
      </div>

      {current === "failed" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {say("The price history could not be loaded. Try another range, or again in a moment.", "历史价格加载失败，请换个区间或稍后再试。")}
        </p>
      ) : !shown ? (
        <div className="mt-4 h-72 animate-pulse rounded-lg bg-muted/40" aria-label={say("Loading", "加载中")} />
      ) : candles.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {say("No price history for this range.", "这个区间没有历史价格。")}
        </p>
      ) : (
        <div className={cn("mt-4 grid gap-4", hasVolume && "lg:grid-cols-[minmax(0,1fr)_13rem]")}>
          <div className="min-w-0">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={candles} syncId={sync} margin={{ top: 4, right: 0, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="key" hide />
                  <YAxis
                    orientation="right"
                    domain={[low - pad, high + pad]}
                    tickFormatter={priceTick}
                    tick={AXIS_TICK}
                    width={64}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const candle = payload[0].payload as Candle;
                      return (
                        <Tip
                          label={tooltipLabel(candle)}
                          rows={[
                            { name: say("Open", "开"), value: exactUsd(candle.open ?? candle.close) },
                            { name: say("High", "高"), value: exactUsd(candle.span[1]) },
                            { name: say("Low", "低"), value: exactUsd(candle.span[0]) },
                            { name: say("Close", "收"), value: exactUsd(candle.close) },
                            ...(candle.change !== undefined
                              ? [{ name: say("Change", "涨跌"), value: `${candle.change >= 0 ? "+" : ""}${candle.change.toFixed(2)}%` }]
                              : []),
                            ...(candle.traded !== undefined
                              ? [{ name: say("Traded", "成交额"), value: `$${compactNumber(candle.traded)}` }]
                              : []),
                          ]}
                        />
                      );
                    }}
                  />
                  {averageCost !== undefined && averageCost > 0 && (
                    <ReferenceLine
                      y={averageCost}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="4 4"
                      label={{
                        value: say(`you paid ${exactUsd(averageCost)}`, `你的均价 ${exactUsd(averageCost)}`),
                        position: "insideTopLeft",
                        fontSize: 11,
                        fill: "var(--muted-foreground)",
                      }}
                    />
                  )}
                  {level && level.price > 0 && (
                    <ReferenceLine
                      y={level.price}
                      stroke={seriesColor(0)}
                      strokeDasharray="4 4"
                      label={{
                        value: `${level.label} ${exactUsd(level.price)}`,
                        position: "insideBottomLeft",
                        fontSize: 11,
                        fill: seriesColor(0),
                      }}
                    />
                  )}
                  <Bar dataKey="span" shape={<CandleShape />} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {hasVolume && (
              <div className="mt-1 h-20">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={candles} syncId={sync} margin={{ top: 4, right: 0, bottom: 0, left: 8 }}>
                    <XAxis dataKey="key" tickFormatter={xTick} tick={AXIS_TICK} minTickGap={40} />
                    <YAxis
                      orientation="right"
                      tickFormatter={(value) => `$${compactNumber(Number(value))}`}
                      tick={AXIS_TICK}
                      width={64}
                      axisLine={false}
                      tickLine={false}
                      tickCount={2}
                    />
                    <Tooltip cursor={{ fill: GRID, fillOpacity: 0.4 }} content={() => null} />
                    <Bar dataKey="traded" fill={VOLUME} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {hasVolume && last && (
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {say("Where it traded", "成交集中的价位")}
              </p>
              <ul className="mt-2 space-y-1">
                {bands.map((band) => {
                  const here = last.close >= band.from && last.close <= band.to;
                  // As many decimals as the band is narrow: a day's bands on a
                  // $195 share are cents apart, a year's are dollars.
                  const width = band.to - band.from;
                  const digits = width < 1 ? 2 : width < 10 ? 1 : 0;
                  return (
                    <li key={band.from} className="flex items-center gap-2 text-[11px]">
                      <span className="tabular w-24 shrink-0 text-right text-muted-foreground">
                        {band.from.toFixed(digits)}–{band.to.toFixed(digits)}
                      </span>
                      <span className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/40">
                        <span
                          className="block h-full rounded-sm"
                          style={{
                            width: `${busiest > 0 ? (band.traded / busiest) * 100 : 0}%`,
                            background: here ? seriesColor(0) : VOLUME,
                          }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {say("Blue: the band it is in now", "蓝色：现价所在的区间")}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
