"use client";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { useLocale } from "@/lib/i18n/context";
import {
  ChartFrame,
  GRID,
  AXIS_TICK,
  SeriesLegend,
  seriesColor,
} from "@/components/charts/chart-kit";
import { Input } from "@/components/ui/field";
import { Help } from "@/components/ui/help";
import { expirationPayoff, payoffProfile } from "@/lib/analysis/math";
import {
  impliedVol,
  valueToday,
  yearsUntil,
  type PricedLeg,
} from "@/lib/analysis/options-pricing";
import type { OptionGreeks } from "@/types/market";
import type { PositionView } from "@/types/portfolio";

/**
 * A stand-in for the risk-free rate. It moves the answer by cents on a
 * three-month option and is not worth a data feed of its own; when it starts
 * to matter, it becomes an input.
 */
const RATE = 0.04;

export function PayoffExplorer({
  positions,
  underlyingPrices = {},
  greeks = {},
}: {
  positions: PositionView[];
  /** Live share price per underlying, needed to price the contracts. */
  underlyingPrices?: Record<string, number>;
  /**
   * The broker's own risk figures per contract. Preferred over anything
   * derived here: the market quoted the price with these numbers, so using
   * them keeps this screen and the broker's app telling the same story.
   */
  greeks?: Record<string, OptionGreeks>;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const options = positions.filter(
    (p) =>
      p.instrumentType === "option" &&
      p.strike !== undefined &&
      p.optionType &&
      p.underlyingSymbol &&
      p.expirationDate,
  );
  const keys = [
    ...new Set(
      options.map(
        (p) => `${p.underlyingSymbol}|${p.expirationDate}|${p.currency}`,
      ),
    ),
  ];
  const [group, setGroup] = useState(keys[0] ?? "");
  const [premiums, setPremiums] = useState<Record<string, string>>({});
  const [fees, setFees] = useState("0");
  const [price, setPrice] = useState<number | null>(null);
  /** How many days from now to value the position at. 0 is today. */
  const [daysAhead, setDaysAhead] = useState(0);
  if (!keys.length) return null;
  const chosen = options.filter(
    (p) => `${p.underlyingSymbol}|${p.expirationDate}|${p.currency}` === group,
  );
  const anchor = Math.max(...chosen.map((p) => p.strike!));
  const parsedPremium = (p: PositionView) =>
    Number(premiums[p.id] ?? String(Math.max(0, p.averageCost ?? 0)));
  const valid =
    chosen.every(
      (p) =>
        (premiums[p.id] ?? String(p.averageCost ?? "")).trim() !== "" &&
        Number.isFinite(parsedPremium(p)) &&
        parsedPremium(p) >= 0 &&
        Number.isFinite(p.quantity) &&
        Number.isFinite(p.contractMultiplier ?? 100) &&
        (p.contractMultiplier ?? 100) > 0,
    ) &&
    fees.trim() !== "" &&
    Number.isFinite(Number(fees)) &&
    Number(fees) >= 0;
  const legs = chosen.map((p) => ({
    type: p.optionType!,
    strike: p.strike!,
    premium: parsedPremium(p),
    quantity: p.quantity,
    multiplier: p.contractMultiplier ?? 100,
  }));
  /**
   * The same position valued as it stands today, with the time it still has.
   *
   * Each leg's volatility is solved from its own current market price, so the
   * curve passes through what the position is actually marked at rather than
   * through a number somebody guessed. If any leg cannot be inverted — no
   * trade today, a crossed quote — the whole "today" line is dropped instead
   * of being drawn from a mixture of real and invented volatilities.
   */
  const spot = underlyingPrices[chosen[0]?.underlyingSymbol ?? ""] ?? 0;
  const years = yearsUntil(chosen[0]?.expirationDate ?? "");
  // The scenario starts where the share is now, which is the question people
  // arrive with; the highest strike was an arbitrary place to begin.
  const scenario = price ?? (spot > 0 ? spot : anchor);
  const underlying = chosen[0]?.underlyingSymbol ?? "";

  /**
   * Volatility per leg, the broker's figure first.
   *
   * moomoo publishes implied volatility alongside the price, which is the
   * number the contract was actually quoted with. Falling back to solving it
   * out of the price is a good reconstruction of the same quantity, and is
   * what happens when the feed omits it — but it is a reconstruction, so the
   * screen says which one it used.
   */
  const pricedLegs: PricedLeg[] = chosen.map((p) => {
    const published = greeks[p.symbol]?.impliedVolatility;
    const usable = published !== undefined && published > 0 ? published : null;

    return {
      type: p.optionType!,
      strike: p.strike!,
      quantity: p.quantity,
      multiplier: p.contractMultiplier ?? 100,
      premium: parsedPremium(p),
      vol:
        usable ??
        (spot > 0 && years > 0 && (p.currentPrice ?? 0) > 0
          ? impliedVol(p.currentPrice!, p.optionType!, spot, p.strike!, years, RATE)
          : null),
    };
  });

  const fromBroker = chosen.some(
    (p) => (greeks[p.symbol]?.impliedVolatility ?? 0) > 0,
  );

  /**
   * The position's overall sensitivity, added up across the legs.
   *
   * Delta is how many shares this behaves like: a spread at +0.30 delta on
   * two contracts moves like 60 shares, so a dollar on the share is about
   * sixty dollars here. Theta is what one day of waiting costs, which is the
   * number people are most surprised by and the reason an option left alone
   * quietly shrinks.
   */
  const totals = chosen.reduce(
    (sum, p) => {
      const g = greeks[p.symbol];
      const units = p.quantity * (p.contractMultiplier ?? 100);
      return {
        delta: sum.delta + (g?.delta ?? 0) * units,
        theta: sum.theta + (g?.theta ?? 0) * units,
        any: sum.any || g?.delta !== undefined || g?.theta !== undefined,
      };
    },
    { delta: 0, theta: 0, any: false },
  );

  const hasToday =
    valid && spot > 0 && years > 0 && pricedLegs.every((leg) => leg.vol !== null);

  const daysLeft = Math.round(years * 365.25);

  /**
   * Time left once the clock has been wound forward.
   *
   * The slider moves the valuation date, not the expiry. At zero it is today;
   * at the far end there is nothing left and the curve lands exactly on the
   * expiry line — which is the point being made. Waiting is not free, and the
   * only way to see what it costs is to watch the curve fall towards the
   * kinked line underneath it.
   */
  const daysRemaining = Math.max(0, daysLeft - daysAhead);
  const yearsRemaining = Math.max(0, years - daysAhead / 365.25);

  /** A few dates in between, so the decay is visible without moving anything. */
  const STEPS = hasToday && daysLeft > 14
    ? [0.66, 0.33].map((share) => ({
        years: years * share,
        days: Math.round(daysLeft * share),
      }))
    : [];

  const curve = valid
    ? Array.from({ length: 61 }, (_, i) => {
        const at = (anchor * 2 * i) / 60;
        const point: Record<string, number | null> = {
          price: at,
          pnl: expirationPayoff(legs, at, Number(fees)),
          today: hasToday
            ? valueToday(pricedLegs, at, yearsRemaining, RATE, Number(fees))
            : null,
        };
        STEPS.forEach((step, index) => {
          point[`step${index}`] = valueToday(
            pricedLegs,
            at,
            step.years,
            RATE,
            Number(fees),
          );
        });
        return point;
      })
    : [];

  const todayNow = hasToday
    ? valueToday(pricedLegs, scenario, yearsRemaining, RATE, Number(fees))
    : null;
  const money = (n: number) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", {
      style: "currency",
      currency: chosen[0]?.currency ?? "USD",
    }).format(n);
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;
  const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "");

  // What was paid against what it is worth now, leg by leg and in total. The
  // one question every holder asks first, which the old screen only answered
  // as an editable "premium" field with no current price beside it.
  const rows = chosen.map((p) => {
    const units = p.quantity * (p.contractMultiplier ?? 100);
    const opened = parsedPremium(p);
    const now = p.currentPrice;
    return {
      p,
      opened,
      now,
      change: now === undefined ? null : (now - opened) * units,
      // Of what was put at stake, so the sign follows the money: a sold
      // contract whose price rose 19.7% is a 19.7% loss to whoever sold it.
      percent:
        now === undefined || opened === 0
          ? null
          : (((now - opened) * units) / Math.abs(opened * units)) * 100,
    };
  });
  const netOpened = chosen.reduce(
    (sum, p) => sum + parsedPremium(p) * p.quantity * (p.contractMultiplier ?? 100),
    0,
  );
  const allPriced = rows.every((row) => row.now !== undefined);
  const netNow = allPriced
    ? chosen.reduce(
        (sum, p) => sum + (p.currentPrice ?? 0) * p.quantity * (p.contractMultiplier ?? 100),
        0,
      )
    : null;

  const profile = valid ? payoffProfile(legs, Number(fees)) : null;
  const expiry = new Date(`${chosen[0]?.expirationDate}T12:00:00Z`).toLocaleDateString(
    zh ? "zh-CN" : "en-GB",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  );
  const contract = (p: PositionView) =>
    `${p.quantity > 0 ? say("Bought", "买入") : say("Sold", "卖出")} ${Math.abs(p.quantity)} × ${p.strike} ${
      p.optionType === "call" ? say("call", "看涨") : say("put", "看跌")
    }`;

  return (
    <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
      <header className="space-y-1">
        <h2 className="flex items-center gap-1 font-medium">
          {say("Option position", "期权持仓")}
          <Help title={say("How to read this", "怎么看这一块")}>
            {say(
              "The table is what you paid for each contract and what it is worth now, per share — one contract is 100 shares, so 43.80 is $4,380 a contract. Below it: where the share has to finish for the position to break even, the best and worst it can do if held to the last day, and how it moves today. The chart shows profit or loss at every share price: the solid line is holding to the last day, the dashed line is selling on the day you pick instead, and the gap between them is time value — what somebody will pay for the chance it keeps going. That gap shrinks every day and is gone at expiry, which the faint lines show. Only contracts on the same share, expiring the same day, are combined. Held to expiry; no early assignment, no tax.",
              "表格列出每张合约你买入（或卖出）时的价格和现在的价格，均为每股价格——一张合约是 100 股，所以 43.80 就是每张 4,380 美元。下面是：正股到期时要到什么价位才保本、持有到最后一天最多赚多少和最多亏多少，以及今天它随股价变动的幅度。图表画出每个股价下的盈亏：实线是持有到最后一天，虚线是在你选的那天卖出，两者之间的差距就是时间价值——别人愿意为「后面还有机会」多付的钱。这个差距每天都在缩小，到期归零，浅色的线画的就是这个过程。只合并同一只正股、同一天到期的合约。假设持有到期，不考虑提前行权和税费。",
            )}
          </Help>
        </h2>
        <p className="text-xs text-muted-foreground">
          {say(
            "What you paid, what it is worth now, and what it could make or lose",
            "你付了多少、现在值多少、之后可能赚多少亏多少",
          )}
        </p>
      </header>

      {keys.length > 1 ? (
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">{say("Which position", "哪一组")}</span>
          <select
            className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-background px-3"
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setPrice(null);
              setDaysAhead(0);
            }}
          >
            {keys.map((key) => {
              const [symbol, date] = key.split("|");
              return (
                <option key={key} value={key}>
                  {symbol} · {say("expires", "到期")} {date}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
      <p className="text-sm">
        <span className="font-medium">{underlying}</span>{" "}
        <span className="text-muted-foreground">
          · {say("expires", "到期")} {expiry} · {daysLeft} {say("days left", "天后到期")}
          {spot > 0 && (
            <>
              {" "}· {say("share now", "正股现价")} <span className="tabular text-foreground">{money(spot)}</span>
            </>
          )}
        </span>
      </p>

      {/* A list, not a table. Four columns of money do not fit a phone:
          they either ran into each other or scrolled sideways, and a contract
          name wrapped to four lines. Two lines per leg read at any width. */}
      <div>
        <p className="flex items-center gap-0.5 text-xs text-muted-foreground">
          {say("What you paid, and what it is worth now", "买入价与现价")}
          <Help title={say("Opened at, and now", "开仓价与现价")}>
            {say(
              "\"Opened\" is what one share's worth of the contract cost when you bought it — or brought in when you sold it. \"Now\" is the broker's latest price for it; for a contract you sold, that is what buying it back would cost. Both are per share: a contract is 100 shares, so 43.80 is $4,380 a contract. The opening price comes from the broker and can be changed under Adjust.",
              "「开仓」是买入时每股付出的价格，或卖出时每股收到的价格。「现价」是券商给出的最新价格；对于你卖出的合约，这是现在把它买回来要花的钱。两者都是每股价格：一张合约是 100 股，所以 43.80 就是每张 4,380 美元。开仓价来自券商，可在「调整」里修改。",
            )}
          </Help>
        </p>
        <ul className="mt-1 divide-y divide-border border-y border-border text-sm">
          {rows.map((row) => (
            <li key={row.p.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">{contract(row.p)}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {say("opened", "开仓")} {row.opened.toFixed(2)} → {say("now", "现价")}{" "}
                  {row.now === undefined ? "—" : row.now.toFixed(2)}
                </p>
              </div>
              <div className={`tabular shrink-0 text-right ${row.change === null ? "" : tone(row.change)}`}>
                <p className="font-medium">{row.change === null ? "—" : signed(row.change)}</p>
                {row.percent !== null && (
                  <p className="text-xs text-muted-foreground">
                    {row.percent >= 0 ? "+" : ""}
                    {row.percent.toFixed(1)}%
                  </p>
                )}
              </div>
            </li>
          ))}
          <li className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="font-medium">
                {netOpened >= 0 ? say("Paid in total", "合计付出") : say("Received in total", "合计收到")}{" "}
                <span className="tabular">{money(Math.abs(netOpened))}</span>
              </p>
              <p className="tabular text-xs text-muted-foreground">
                {netNow !== null && netNow < 0
                  ? say("costs to close now", "现在平仓需付")
                  : say("worth now", "现值")}{" "}
                {netNow === null ? "—" : money(Math.abs(netNow))}
              </p>
            </div>
            <p className={`tabular shrink-0 text-right font-semibold ${netNow === null ? "" : tone(netNow - netOpened)}`}>
              {netNow === null ? "—" : signed(netNow - netOpened)}
            </p>
          </li>
        </ul>
      </div>

      {profile && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Figure
            label={say("Break-even at expiry", "到期保本价")}
            help={say(
              `Where ${underlying} has to finish on the last day for this position to neither make nor lose money.`,
              `到期那天 ${underlying} 收在什么价位，这组期权刚好不赚不亏。`,
            )}
            value={
              profile.breakEvens.length === 0
                ? "—"
                : profile.breakEvens.map((price) => money(price)).join(say(" or ", " 或 "))
            }
          />
          <Figure
            label={say("Best case at expiry", "到期最多赚")}
            help={say(
              "The most this can make if held to the last day. \"No limit\" means it keeps gaining for as long as the share keeps rising.",
              "持有到最后一天最多能赚多少。「无上限」表示只要正股一直涨，它就一直赚。",
            )}
            value={profile.maxProfit === Infinity ? say("No limit", "无上限") : signed(profile.maxProfit)}
            className={profile.maxProfit === Infinity ? "text-positive" : tone(profile.maxProfit)}
          />
          <Figure
            label={say("Worst case at expiry", "到期最多亏")}
            help={say(
              "The most this can lose if held to the last day. \"No limit\" means the loss keeps growing for as long as the share keeps rising — the risk of a sold call with nothing behind it.",
              "持有到最后一天最多会亏多少。「无上限」表示只要正股一直涨，亏损就一直扩大——这是裸卖看涨期权的风险。",
            )}
            value={profile.maxLoss === -Infinity ? say("No limit", "无上限") : signed(profile.maxLoss)}
            className={profile.maxLoss === -Infinity ? "text-negative" : tone(profile.maxLoss)}
          />
          {totals.any && (
            <Figure
              label={say(`If ${underlying} moves $1`, `${underlying} 每变动 1 美元`)}
              help={say(
                `How much the position gains or loses today for each dollar ${underlying} moves — it behaves like ${Math.abs(totals.delta).toFixed(0)} shares. This is its delta, added up across the contracts, and it changes as the share moves and as time passes.`,
                `${underlying} 每涨跌 1 美元，这组期权今天大约赚亏多少——相当于持有 ${Math.abs(totals.delta).toFixed(0)} 股。这就是各合约的 Delta 加总，会随股价和时间变化。`,
              )}
              value={`±${money(Math.abs(totals.delta))}`}
              sub={say(
                `acts like ${totals.delta.toFixed(0)} shares`,
                `相当于 ${totals.delta.toFixed(0)} 股`,
              )}
            />
          )}
          {totals.any && (
            <Figure
              label={say("Each day that passes", "每过一天")}
              help={say(
                "What one more day does to the position if the share price does not move (its theta). Bought options lose a little value every day; sold ones gain it — which is why a spread can earn from waiting.",
                "如果股价不动，每多过一天这组期权会赚或亏多少（Theta）。买入的期权每天都会损耗一点价值，卖出的则相反——所以价差组合有时靠「等」也能赚钱。",
              )}
              value={signed(totals.theta)}
              className={tone(totals.theta)}
              sub={
                totals.theta >= 0
                  ? say("time is working for you", "时间对你有利")
                  : say("time is working against you", "时间对你不利")
              }
            />
          )}
        </dl>
      )}

      <div className="space-y-4 rounded-lg border border-border p-4">
        <label className="block text-sm">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              {say(`If ${underlying} is at`, `假设 ${underlying} 价格为`)}{" "}
              <strong className="tabular">{money(scenario)}</strong>
            </span>
            {spot > 0 && price !== null && (
              <button
                type="button"
                onClick={() => setPrice(null)}
                className="text-xs text-muted-foreground underline underline-offset-4"
              >
                {say("back to today's price", "回到现价")}
              </button>
            )}
          </span>
          <input
            className="mt-3 block w-full accent-[var(--accent)]"
            type="range"
            min="0"
            max={anchor * 2}
            step="0.01"
            value={scenario}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </label>

        {/* The second dimension. A payoff chart answers "what if the share
            moves"; this answers "what if it does not", which is the question
            that costs people money. Drag it to expiry and the curve settles
            exactly onto the kinked line. */}
        {hasToday && daysLeft > 0 && (
          <label className="block text-sm">
            {say("Sold", "卖出时间")}{" "}
            <strong>
              {daysAhead === 0
                ? say("today", "今天")
                : daysRemaining === 0
                  ? say("on expiry day", "到期当天")
                  : say(`in ${daysAhead} days`, `${daysAhead} 天后`)}
            </strong>
            {daysAhead > 0 && daysRemaining > 0 && (
              <span className="text-muted-foreground">
                {" "}· {say(`${daysRemaining} days still to run`, `还剩 ${daysRemaining} 天`)}
              </span>
            )}
            <input
              className="mt-3 block w-full accent-[var(--accent)]"
              type="range"
              min="0"
              max={daysLeft}
              step="1"
              value={daysAhead}
              onChange={(e) => setDaysAhead(Number(e.target.value))}
            />
          </label>
        )}

        {valid ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">
                {say("Held to the last day", "持有到最后一天")}
              </p>
              <output
                className={`tabular block text-2xl font-semibold ${tone(expirationPayoff(legs, scenario, Number(fees)))}`}
              >
                {signed(expirationPayoff(legs, scenario, Number(fees)))}
              </output>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {daysAhead === 0
                  ? say("Sold today instead", "改为今天卖出")
                  : say(`Sold in ${daysAhead} days instead`, `改为 ${daysAhead} 天后卖出`)}
              </p>
              <output
                className={`tabular block text-2xl font-semibold ${todayNow === null ? "text-muted-foreground" : tone(todayNow)}`}
              >
                {todayNow === null
                  ? say("No usable option price", "缺少可用的期权价格")
                  : signed(todayNow)}
              </output>
            </div>
          </div>
        ) : (
          <output className="block text-sm text-muted-foreground">
            {say("Enter valid prices and fees under Adjust", "请在「调整」里输入有效的价格和费用")}
          </output>
        )}
      </div>

      {valid && (
        <ChartFrame title={say("Profit or loss at each share price", "不同股价下的盈亏")}>
          <div className="flex h-full flex-col gap-2">
            <SeriesLegend
              items={[
                { label: say("Held to the last day", "持有到最后一天"), color: seriesColor(0) },
                ...(hasToday
                  ? [
                      {
                        label:
                          daysAhead === 0
                            ? say("Sold today", "今天卖出")
                            : say(`Sold in ${daysAhead} days`, `${daysAhead} 天后卖出`),
                        color: seriesColor(1),
                      },
                    ]
                  : []),
              ]}
            />
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curve}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    type="number"
                    dataKey="price"
                    domain={[0, anchor * 2]}
                    tick={AXIS_TICK}
                    tickFormatter={(n) => Number(n).toFixed(0)}
                  />
                  <YAxis tick={AXIS_TICK} width={75} />
                  <Tooltip
                    formatter={(v) => money(Number(v))}
                    labelFormatter={(v) => `${underlying} ${money(Number(v))}`}
                  />
                  <ReferenceLine y={0} stroke="var(--muted-foreground)" />
                  <ReferenceLine
                    x={scenario}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="3 3"
                  />
                  <Line
                    dataKey="pnl"
                    name={say("Held to the last day", "持有到最后一天")}
                    type="linear"
                    stroke={seriesColor(0)}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {/* The faint curves are the same position at a third and two
                      thirds of the way to expiry. Seeing them stacked is the
                      clearest statement of time decay there is: the same share
                      price is worth less every month you wait. */}
                  {STEPS.map((step, index) => (
                    <Line
                      key={step.days}
                      dataKey={`step${index}`}
                      name={say(`${step.days} days left`, `还剩 ${step.days} 天`)}
                      type="monotone"
                      stroke={seriesColor(1)}
                      strokeOpacity={0.3}
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  {hasToday && (
                    <Line
                      dataKey="today"
                      name={
                        daysAhead === 0
                          ? say("Sold today", "今天卖出")
                          : say(`Sold in ${daysAhead} days`, `${daysAhead} 天后卖出`)
                      }
                      type="monotone"
                      stroke={seriesColor(1)}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </ChartFrame>
      )}

      {/* Out of the way, because almost nobody needs it: the broker's cost is
          right for the position as held. It is here for asking "what if I had
          paid less", and for fees the broker does not report. */}
      <details className="rounded-lg border border-border p-4 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {say("Adjust the prices used (optional)", "调整所用价格（可选）")}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {chosen.map((p) => (
            <label key={p.id} className="text-sm">
              {contract(p)} · {say("opened at, per share", "开仓价（每股）")}
              <Input
                type="number"
                min="0"
                step="0.01"
                value={premiums[p.id] ?? String(Math.max(0, p.averageCost ?? 0))}
                onChange={(e) => setPremiums({ ...premiums, [p.id]: e.target.value })}
              />
              <span className="block text-xs text-muted-foreground">
                {greeks[p.symbol]?.impliedVolatility !== undefined && (
                  <>
                    {say("Implied volatility", "隐含波动率")}{" "}
                    {(greeks[p.symbol]!.impliedVolatility! * 100).toFixed(1)}%
                  </>
                )}
                {greeks[p.symbol]?.delta !== undefined && (
                  <> · Delta {greeks[p.symbol]!.delta!.toFixed(3)}</>
                )}
                {greeks[p.symbol]?.theta !== undefined && (
                  <> · Theta {greeks[p.symbol]!.theta!.toFixed(3)}</>
                )}
              </span>
            </label>
          ))}
          <label className="text-sm">
            {say("Fees, in total", "总费用")}
            <Input
              type="number"
              min="0"
              step="0.01"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
            />
          </label>
        </div>
        {hasToday && (
          <p className="mt-3 text-xs text-muted-foreground">
            {fromBroker
              ? say(
                  "The \"sold\" line uses the implied volatility the broker publishes with each contract's price.",
                  "「卖出」曲线使用券商随合约价格一并发布的隐含波动率。",
                )
              : say(
                  "The broker did not publish an implied volatility for these contracts, so the \"sold\" line works it back out of each one's own market price.",
                  "券商没有提供这些合约的隐含波动率，因此「卖出」曲线由每张合约自己的市场价格反推得出。",
                )}
          </p>
        )}
      </details>
    </section>
  );
}

/** One of the headline figures, with what it means one tap away. */
function Figure({
  label,
  help,
  value,
  sub,
  className = "",
}: {
  label: string;
  help: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <dt className="flex items-start gap-0.5 text-xs leading-snug text-muted-foreground">
        <span className="min-w-0">{label}</span>
        <Help title={label}>{help}</Help>
      </dt>
      <dd className={`tabular mt-1 text-sm font-semibold ${className}`}>{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}
