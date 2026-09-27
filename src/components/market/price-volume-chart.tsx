"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK, GRID, Tip, compactUsd, exactUsd, seriesColor } from "@/components/charts/chart-kit";
import { Help } from "@/components/ui/help";
import { useLocale } from "@/lib/i18n/context";
import { tradedByPrice } from "@/lib/market/traded-by-price";
import { cn } from "@/lib/utils";
import type { HistoricalPrice } from "@/types/market";

const RANGES = [
  { key: "1M", bars: 22 },
  { key: "3M", bars: 64 },
  { key: "6M", bars: 128 },
  { key: "1Y", bars: 260 },
] as const;

const VOLUME = "var(--chart-other)";

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}/${Number(day)}`;
}

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/**
 * The share's price, what traded each day, and at which prices.
 *
 * Replaced "position value history", which was the closing price times
 * today's quantity — the price chart again, scaled by a constant, and wrong
 * for any day before the holding reached its current size. Trading activity
 * is what that chart could never show.
 *
 * Three views of the same days, never two scales on one chart: the price
 * line on top (with what you paid, if you hold it), the money traded each day
 * below it on the same dates, and beside them the price bands where most of
 * that money changed hands. Money rather than shares throughout, so a split
 * or newly issued shares does not make one period look busier than another.
 */
export function PriceVolumeChart({
  history,
  averageCost,
}: {
  history: HistoricalPrice[];
  /** What you paid per share, if you hold it, drawn across the price. */
  averageCost?: number;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("6M");

  if (history.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {say("Price and trading", "价格与成交")}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {say("No price history available for this symbol.", "暂时没有这个代码的历史价格。")}
        </p>
      </section>
    );
  }

  const bars = RANGES.find((r) => r.key === range)?.bars ?? 128;
  const data = history.slice(-bars).map((day) => ({
    ...day,
    traded: day.turnover ?? (day.volume !== undefined ? day.volume * day.close : undefined),
  }));
  const hasVolume = data.some((day) => day.traded !== undefined && day.traded > 0);
  const last = data[data.length - 1];
  const bands = hasVolume ? tradedByPrice(data, 10).reverse() : [];
  const busiest = Math.max(0, ...bands.map((band) => band.traded));

  const closes = data.map((day) => day.close);
  const low = Math.min(...closes, averageCost ?? Infinity);
  const high = Math.max(...closes, averageCost ?? -Infinity);
  const pad = (high - low) * 0.08 || high * 0.02 || 1;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {say("Price and trading", "价格与成交")}
          <Help title={say("Price and trading", "价格与成交")}>
            {say(
              "Top: the closing price each day, with the price you paid as a dashed line if you hold it. Below: how much money changed hands each day. Busy days usually mean news. Beside: the price bands where most of that money traded over the period — prices where a lot changed hands tend to matter again, because many people bought or sold there. Money traded is used rather than shares, so a split or newly issued shares does not make one period look busier than another.",
              "上图：每天的收盘价；如果你持有，虚线是你的买入均价。下图：每天的成交金额，放量的日子通常有消息。右侧：这段时间里成交最集中的价格区间——成交特别多的价位往往会再次起作用，因为很多人在那里买入或卖出。这里用成交金额而不是股数，这样拆股或增发新股不会让某段时间显得格外活跃。",
            )}
          </Help>
        </h2>
        <div className="flex gap-1" role="group" aria-label={say("Period", "区间")}>
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
              className={cn(
                "min-h-8 rounded-md px-2.5 text-xs",
                range === option.key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {option.key}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("mt-4 grid gap-4", hasVolume && "lg:grid-cols-[minmax(0,1fr)_14rem]")}>
        <div className="min-w-0">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} minTickGap={40} hide={hasVolume} />
                <YAxis
                  domain={[low - pad, high + pad]}
                  tickFormatter={compactUsd}
                  tick={AXIS_TICK}
                  width={56}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const day = payload[0].payload as (typeof data)[number];
                    return (
                      <Tip
                        label={day.date}
                        rows={[
                          { name: say("Close", "收盘"), value: exactUsd(day.close) },
                          ...(day.traded !== undefined
                            ? [{ name: say("Traded", "成交额"), value: `$${compactNumber(day.traded)}` }]
                            : []),
                          ...(day.volume !== undefined
                            ? [{ name: say("Shares", "成交量"), value: compactNumber(day.volume) }]
                            : []),
                        ]}
                      />
                    );
                  }}
                />
                {averageCost !== undefined && (
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
                <Line
                  dataKey="close"
                  stroke={seriesColor(0)}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {hasVolume && (
            <div className="mt-1 h-20">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} minTickGap={40} />
                  <YAxis
                    tickFormatter={(value) => `$${compactNumber(Number(value))}`}
                    tick={AXIS_TICK}
                    width={56}
                    axisLine={false}
                    tickLine={false}
                    tickCount={2}
                  />
                  <Tooltip
                    cursor={{ fill: GRID, fillOpacity: 0.4 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const day = payload[0].payload as (typeof data)[number];
                      return (
                        <Tip
                          label={day.date}
                          rows={[
                            { name: say("Traded", "成交额"), value: `$${compactNumber(day.traded ?? 0)}` },
                            ...(day.volume !== undefined
                              ? [{ name: say("Shares", "成交量"), value: compactNumber(day.volume) }]
                              : []),
                          ]}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="traded" fill={VOLUME} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {hasVolume && (
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {say("Where it traded", "成交集中的价位")}
            </p>
            <ul className="mt-2 space-y-1">
              {bands.map((band) => {
                const current = last.close >= band.from && last.close <= band.to;
                return (
                  <li key={band.from} className="flex items-center gap-2 text-[11px]">
                    <span className="tabular w-20 shrink-0 text-right text-muted-foreground">
                      {band.from.toFixed(band.from < 10 ? 2 : 0)}–{band.to.toFixed(band.to < 10 ? 2 : 0)}
                    </span>
                    <span className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/40">
                      <span
                        className="block h-full rounded-sm"
                        style={{
                          width: `${busiest > 0 ? (band.traded / busiest) * 100 : 0}%`,
                          background: current ? seriesColor(0) : VOLUME,
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
    </section>
  );
}
