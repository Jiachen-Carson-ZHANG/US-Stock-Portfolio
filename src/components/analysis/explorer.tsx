"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  ChartFrame,
  AXIS_TICK,
  GRID,
  seriesColor,
} from "@/components/charts/chart-kit";
import { ValueLine } from "@/components/charts/value-line";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  adjustedSeries,
  analysisStats,
  missingWeekdays,
  benchmarkComparison,
  fxDecomposition,
  monthlyReturns,
} from "@/lib/analysis/math";
import { compareAll, type BenchmarkSeries } from "@/lib/analysis/benchmarks";
import { Help } from "@/components/ui/help";
import {
  CURRENCY_LABEL,
  VIEW_CURRENCIES,
  rateOn,
  type RateSeries,
} from "@/lib/analysis/fx";
import type { AnalysisData } from "@/lib/analysis/store";
import type { PortfolioSnapshot } from "@/types/portfolio";

export function PerformanceExplorer({
  portfolioSlug,
  snapshots,
  initial,
  owner,
  currency,
  benchmarks = [],
  rates = { USD: [], CNY: [], SGD: [], EUR: [] },
  mode = "analysis",
}: {
  /**
   * Whose data a save belongs to. Required: without it the server filed the
   * save under the viewer's own default portfolio, which is not necessarily
   * the one on screen.
   */
  portfolioSlug: string;
  snapshots: PortfolioSnapshot[];
  initial: AnalysisData;
  owner: boolean;
  currency: string;
  /**
   * Live daily closes for the funds the account is measured against. Fetched
   * on the server; compared here, so changing the date range re-bases every
   * line to the new starting day instead of keeping a stale 100.
   */
  benchmarks?: BenchmarkSeries[];
  /** Daily exchange rates, so the account can be read in more than dollars. */
  rates?: RateSeries;
  /**
   * "analysis" is the reading screen; "manage" is the data-entry one. They
   * were the same page, which put a form for typing in bank transfers
   * underneath a performance chart — two different jobs, and the wrong one
   * kept getting in the way of the other.
   */
  mode?: "analysis" | "manage";
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const [data, setData] = useState(initial);
  const [period, setPeriod] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<"benchmark" | "fx">("benchmark");
  const latest = snapshots.at(-1)?.snapshotDate ?? "";
  const selected = useMemo(() => {
    if (period === "all" || !latest) return snapshots;
    const cutoff = new Date(`${latest}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - Number(period));
    return snapshots.filter(
      (s) => s.snapshotDate >= cutoff.toISOString().slice(0, 10),
    );
  }, [snapshots, period, latest]);
  const result = adjustedSeries(selected, data.flows, data.coverage);
  const stats = analysisStats(result);
  // How patchy the history is. This is the honest answer to "is the chart
  // wrong": usually it is not, but it is drawn from fewer days than it looks.
  const gaps = missingWeekdays(result.points.map((point) => point.date));
  const months = monthlyReturns(result, data.flows);
  const comparison =
    currency === "USD"
      ? benchmarkComparison(result.points, data.benchmark)
      : [];
  // The live comparison: VOO, QQQ, ONEQ and the equal mix of the three, all
  // re-based to 100 on the first day the account and every fund share.
  const live = compareAll(result.points, benchmarks);
  const first = selected[0],
    last = selected.at(-1);
  const fmt = (n: number, unit = currency) =>
    new Intl.NumberFormat(zh ? "zh-CN" : "en-US", {
      style: "currency",
      currency: unit,
      maximumFractionDigits: 2,
    }).format(n);
  const pct = (n: number | null) =>
    n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const start = Number(first?.totalMarketValue ?? 0),
    end = Number(last?.totalMarketValue ?? 0);
  const flowEnd = start + result.netFlows;
  const waterfall =
    result.gain === null
      ? []
      : [
          // Named by what they are, not by where they sit. "Start" read as
          // "money you have put in", which it is not: it is what the account
          // was already worth on the first day that has a price, and anything
          // paid in before that day is inside it.
          {
            name: say(
              `Worth on ${first?.snapshotDate ?? ""}`,
              `${first?.snapshotDate ?? ""} 的价值`,
            ),
            range: [0, start],
            amount: start,
          },
          {
            name: say("Paid in since", "期间转入"),
            range: [Math.min(start, flowEnd), Math.max(start, flowEnd)],
            amount: result.netFlows,
          },
          {
            name: say("Made or lost", "投资损益"),
            range: [Math.min(flowEnd, end), Math.max(flowEnd, end)],
            amount: result.gain,
          },
          {
            name: say(
              `Worth on ${last?.snapshotDate ?? ""}`,
              `${last?.snapshotDate ?? ""} 的价值`,
            ),
            range: [0, end],
            amount: end,
          },
        ];
  /**
   * The same account, seen from each currency somebody actually spends.
   *
   * The split is exact rather than approximate: what the investments did is
   * valued at the starting rate, and everything else — including the
   * interaction between a bigger balance and a moved rate — is the exchange
   * rate's doing. The two always add to the total, which is the property that
   * makes the table trustworthy.
   */
  const currencyViews = useMemo(() => {
    if (currency !== "USD" || !first || !last) return [];

    return VIEW_CURRENCIES.flatMap((code) => {
      const series = rates[code] ?? [];
      // One source, published daily by the European Central Bank. A
      // hand-maintained rate table was a second answer to the same question,
      // and two answers that disagree are worse than one that is occasionally
      // a day behind.
      const startRate = code === "USD" ? 1 : rateOn(series, first.snapshotDate);
      const endRate = code === "USD" ? 1 : rateOn(series, last.snapshotDate);
      if (!startRate || !endRate) return [];

      const parts = fxDecomposition(start, end, startRate, endRate);
      return [
        {
          code,
          startRate,
          endRate,
          ratePercent: startRate === 0 ? 0 : ((endRate - startRate) / startRate) * 100,
          startValue: start * startRate,
          endValue: end * endRate,
          // What the rate move alone did to the money. The other half of the
          // old table — the dollar change converted — was labelled "from the
          // investments" and was not: it included every deposit. One column
          // that means one thing beats two that need a paragraph.
          fromRate: parts.currency,
        },
      ];
    });
  }, [currency, first, last, rates, start, end]);

  async function save(body: unknown) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setStatus("");
    setFailed(false);
    try {
      const response = await fetch(
        `/api/analysis?portfolio=${encodeURIComponent(portfolioSlug)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error();
      setData(await response.json());
      setStatus(say("Saved.", "已保存。"));
      return true;
    } catch {
      setFailed(true);
      setStatus(
        say(
          "Could not save. Check dates, numbers and your connection.",
          "保存失败，请检查日期、数值和网络。",
        ),
      );
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const issue = result.issue
    ? {
        review: say(
          "Returns are hidden until the owner reviews deposits and withdrawals for this period. Account values remain available.",
          "所有者确认本期的转入和转出之前，不显示收益率。账户价值仍可查看。",
        ),
        history: say(
          "At least two recorded valuations are needed.",
          "至少需要两次估值记录。",
        ),
        flowGap: say(
          "A cash flow falls on a day without a valuation. Returns need that day’s closing value.",
          "有资金流动日缺少估值，需要该日的收盘价值才能计算收益率。",
        ),
        invalid: say(
          "This period contains unsupported or invalid valuations.",
          "本期包含不支持或无效的估值。",
        ),
      }[result.issue]
    : null;
  // Owner-only data entry. Lifted out of the middle of the page so the
  // records screen can show it on its own: recording a transfer is a
  // bookkeeping job, not something to trip over while reading a chart.
  const manage = owner ? (
        <details className="rounded-xl border border-border bg-surface p-5">
          <summary className="cursor-pointer font-medium">
            {say("Manage analysis data", "管理分析数据")}
          </summary>
          <p className="mt-3 text-sm text-muted-foreground">
            {say(
              "Record external deposits (+) and withdrawals (−), not stock purchases or sales. Include security transfers at their fair value. Editing flows clears the review.",
              "记录外部转入（正数）和转出（负数），不包含股票买卖。证券转入转出按公允价值记录。编辑现金流后需重新确认。",
            )}
          </p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              if (
                await save({
                  action: "flow",
                  date: f.get("date"),
                  amount: Number(f.get("amount")),
                  note: f.get("note"),
                })
              )
                form.reset();
            }}
          >
            <label className="space-y-1 text-sm">
              {say("Date", "日期")}
              <Input name="date" type="date" required />
            </label>
            <label className="space-y-1 text-sm">
              {say("Signed amount", "带符号金额")} ({currency})
              <Input name="amount" type="number" step="0.01" required />
            </label>
            <label className="space-y-1 text-sm">
              {say("Note", "备注")}
              <Input name="note" maxLength={200} />
            </label>
            <Button className="self-end" disabled={busy}>
              {say("Add cash flow", "添加现金流")}
            </Button>
          </form>
          <ul className="mt-4 divide-y divide-border">
            {data.flows.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-2 py-2 text-sm"
              >
                <span>
                  {f.date} · {fmt(f.amount)} · {f.note}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => save({ action: "removeFlow", id: f.id })}
                >
                  {say("Remove", "删除")}
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="mt-6 space-y-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void save({
                action: "review",
                from: f.get("from"),
                to: f.get("to"),
              });
            }}
          >
            <p className="text-sm font-medium">
              {say("Confirm cash-flow coverage", "确认现金流覆盖期间")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                {say("From", "起始日期")}
                <Input
                  name="from"
                  type="date"
                  required
                  defaultValue={first?.snapshotDate}
                />
              </label>
              <label className="text-sm">
                {say("Through", "结束日期")}
                <Input
                  name="to"
                  type="date"
                  required
                  defaultValue={last?.snapshotDate}
                />
              </label>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" required className="mt-1" />
              {say(
                "I checked this entire period. All external flows are recorded, including periods with no flows.",
                "我已检查整个期间，所有外部现金流均已记录，包括没有现金流的期间。",
              )}
            </label>
            <Button disabled={busy}>
              {say("Confirm reviewed period", "确认已审核期间")}
            </Button>
            {data.coverage && (
              <p className="text-xs text-muted-foreground">
                {say("Reviewed", "已确认")}: {data.coverage.from} →{" "}
                {data.coverage.to}
              </p>
            )}
          </form>
          <form
            className="mt-6 space-y-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const rows = String(f.get("csv"))
                  .trim()
                  .split(/\r?\n/)
                  .filter((line) => line.trim() && !/^date\s*,/i.test(line))
                  .map((line) => {
                    const cells = line.split(",");
                    if (cells.length !== 2) throw new Error();
                    return {
                      date: cells[0].trim(),
                      value: Number(cells[1].trim()),
                    };
                  });
                void save({
                  action: "observations",
                  kind,
                  source: f.get("source"),
                  rows,
                });
              } catch {
                setFailed(true);
                setStatus(
                  say(
                    "Use one date,value pair per line.",
                    "每行使用 日期,数值 格式。",
                  ),
                );
              }
            }}
          >
            <p className="text-sm font-medium">
              {say("Import a dated series", "导入带日期的数据")}
            </p>
            <label className="block text-sm">
              {say("Series", "数据系列")}
              <select
                className="mt-1 block w-full rounded-lg border border-border bg-surface p-2"
                value={kind}
                onChange={(e) => setKind(e.target.value as "benchmark" | "fx")}
              >
                <option value="benchmark">
                  {say("Total-return benchmark (USD)", "总回报基准（美元）")}
                </option>
                <option value="fx">
                  {say(
                    "USD/CNY (RMB per dollar)",
                    "美元兑人民币（每美元对应人民币）",
                  )}
                </option>
              </select>
            </label>
            <label className="block text-sm">
              {say("Source and series name", "来源和系列名称")}
              <Input
                name="source"
                required
                minLength={3}
                maxLength={180}
                placeholder={say(
                  "Provider, index name, total-return basis",
                  "提供商、指数名称、总回报口径",
                )}
              />
            </label>
            <label className="block text-sm">
              {say("CSV: date,value", "CSV：日期,数值")}
              <textarea
                name="csv"
                required
                rows={5}
                className="mt-1 w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm"
                placeholder={"date,value\n2026-09-14,100\n2026-09-15,101"}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {say(
                "Replaces this series. At least two unique dates and positive values; benchmark must include dividends and use USD.",
                "将替换本系列。至少需要两个不同日期和正数值；基准必须包含股息并以美元计价。",
              )}
            </p>
            <Button disabled={busy}>
              {say("Import", "导入")}
            </Button>
          </form>
          {status && (
            <p
              role={failed ? "alert" : "status"}
              className={`mt-3 text-sm ${failed ? "text-negative" : "text-positive"}`}
            >
              {status}
            </p>
          )}
        </details>
  ) : null;

  if (mode === "manage") return <div className="space-y-4">{manage}</div>;

  return (
    <div className="space-y-6">
      {/* One header line for the section, with the range, the count and the
          filter together. It used to repeat above and below the cards, in two
          different phrasings, saying the same thing twice. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{say("Over this period", "所选区间")}</span>
          <span className="tabular text-muted-foreground">
            {first?.snapshotDate ?? "—"} → {last?.snapshotDate ?? "—"}
          </span>
          <span className="text-muted-foreground">
            · {selected.length} {say("days priced", "天有估值")}
          </span>
          <Help title={say("What these figures cover", "这些数字算的是什么")}>
            {say(
              "Money paid in or taken out is removed before the sum, so these show how the investments did rather than how much was added — put in ten thousand and the account gets bigger, not better. Transfers count as arriving at the end of their day. The worst fall is measured between days that were actually priced",
              "计算前会先把转入转出的钱剔除，所以这些数字反映的是投资做得怎么样，而不是往里放了多少钱——转进一万块，账户变大了，但没有变好。转账按当天收盘时到账。最大回撤只在有估值记录的日子之间衡量",
            )}
            {gaps > 0 && (
              <>
                {" · "}
                {say(
                  `${gaps} weekday${gaps === 1 ? "" : "s"} here has no recorded value, so the line joins straight across, and a fall spanning a gap looks sharper than it was`,
                  `这段时间有 ${gaps} 个工作日没有记录估值，曲线直接连过去，跨越缺口的下跌看起来会比实际更陡`,
                )}
              </>
            )}
          </Help>
        </p>
        <div className="flex gap-1" aria-label={say("Period", "期间")}>
          {[
            ["7", say("Week", "周")],
            ["30", say("Month", "月")],
            ["90", say("Quarter", "季")],
            ["all", say("All", "全部")],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={period === value ? "primary" : "outline"}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {issue && (
        <p
          className="rounded-xl border border-border bg-muted/40 p-4 text-sm"
          role="status"
        >
          {issue}
        </p>
      )}
      {!issue && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              [
                say("Period return", "期间收益率"),
                pct(stats.periodReturnPercent),
              ],
              [
                say("Observed drawdown", "已观察回撤"),
                stats.maxDrawdownPercent === null
                  ? "—"
                  : `−${stats.maxDrawdownPercent.toFixed(2)}%`,
              ],
              [
                say("Annualised volatility", "年化波动率"),
                pct(stats.annualisedVolatilityPercent),
              ],
              [
                say("Best / worst day", "最佳 / 最差日"),
                `${pct(stats.bestDayPercent)} / ${pct(stats.worstDayPercent)}`,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-border bg-surface p-5"
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="tabular mt-2 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <ChartFrame
            title={say("What changed?", "价值变化来自哪里？")}
            note={say(
              "Account value = starting value + net external flows + investment gain/loss.",
              "账户价值 = 期初价值 + 外部净转入 + 投资损益。",
            )}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfall}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="name" tick={AXIS_TICK} />
                <YAxis
                  tick={AXIS_TICK}
                  width={72}
                  tickFormatter={(n) =>
                    Intl.NumberFormat("en", { notation: "compact" }).format(n)
                  }
                />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-border bg-surface p-3 text-sm">
                        {payload[0].payload.name}:{" "}
                        {fmt(payload[0].payload.amount)}
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="range" radius={4} isAnimationActive={false}>
                  {waterfall.map((row, i) => (
                    <Cell
                      key={row.name}
                      fill={
                        i === 1 || i === 2
                          ? row.amount < 0
                            ? "var(--negative)"
                            : "var(--positive)"
                          : seriesColor(0)
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            {waterfall.map((row) => (
              <span key={row.name}>
                {row.name}: <strong>{fmt(row.amount)}</strong>
              </span>
            ))}
          </div>
          <ChartFrame
            title={say("Growth of 100", "100 的增长轨迹")}
            note={say(
              "Where 100 put in on the first day would stand now, ignoring anything added or withdrawn since.",
              "第一天投入 100 元，到今天变成多少；期间的转入转出不计。",
            )}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.points}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} minTickGap={50} />
                <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} />
                <Tooltip formatter={(v) => Number(v).toFixed(2)} />
                <Line
                  dataKey="index"
                  name={say("Portfolio", "组合")}
                  stroke={seriesColor(0)}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="font-medium">
              {say("Monthly return calendar", "月度收益日历")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {say(
                "Observed portions only; select a month to see its exact coverage. Missing months are not zero returns.",
                "仅显示已观察期间；选择月份查看具体覆盖日期。缺失月份不代表零收益。",
              )}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {months.map((m) => (
                <button
                  key={m.month}
                  onClick={() => setSelectedMonth(m.month)}
                  aria-pressed={selectedMonth === m.month}
                  className={`rounded-lg border p-3 text-left focus-visible:ring-2 focus-visible:ring-accent ${selectedMonth === m.month ? "border-accent" : "border-border"}`}
                >
                  <span className="block text-xs text-muted-foreground">
                    {m.month}
                  </span>
                  <strong
                    className={
                      m.percent < 0 ? "text-negative" : "text-positive"
                    }
                  >
                    {pct(m.percent)}
                  </strong>
                  {/* The percentage is time-weighted and comparable between
                      months; the amount is what actually landed in the
                      account. People ask for both. */}
                  <span
                    className={`block text-xs tabular ${
                      m.amount < 0 ? "text-negative" : "text-positive"
                    }`}
                  >
                    {m.amount >= 0 ? "+" : "−"}
                    {fmt(Math.abs(m.amount))}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {m.from.slice(5)} → {m.to.slice(5)}
                  </span>
                </button>
              ))}
            </div>
            {months
              .filter((m) => m.month === selectedMonth)
              .map((m) => (
                <p key={m.month} className="mt-3 text-sm">
                  {m.from} → {m.to} · {m.observations}{" "}
                  {say("days counted", "天计入")} · {pct(m.percent)} ·{" "}
                  {m.amount >= 0 ? "+" : "−"}
                  {fmt(Math.abs(m.amount))}
                  {m.flows !== 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({say("excludes", "不含")} {fmt(m.flows)}{" "}
                      {say("paid in", "转入")})
                    </span>
                  )}
                </p>
              ))}
          </section>
        </>
      )}
      <ValueLine
        currency={currency}
        title={say(
          "Portfolio value (includes cash flows)",
          "组合价值（含现金流）",
        )}
        data={selected.map((s) => ({
          date: s.snapshotDate,
          value: Number(s.totalMarketValue),
        }))}
      />
      <section className="space-y-3">
        <h2 className="font-medium">
          {say("Portfolio versus benchmark", "投资组合与基准")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {say(
            "Put the same money into each on the first day and watch what happens. Every line starts at 100 on that day, so the gap between them is the difference in result, not the difference in size. The mix is a third in each fund.",
            "在同一天把同样一笔钱分别投进去，看看后来各自变成多少。所有曲线都从那天的 100 起步，因此曲线之间的差距就是成绩的差距，而不是本金的差距。「等额组合」是三只各买三分之一。",
          )}{" "}
          {live.rows.length >= 2 ? "" : data.sources.benchmark}
        </p>
        {live.rows.length >= 2 ? (
          <>
            <p className="text-xs text-muted-foreground">
              {live.rows[0].date} → {live.rows.at(-1)?.date}
            </p>
            <ChartFrame title={say("Growth of the same money", "同一笔钱的增长")}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={live.rows}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="date" tick={AXIS_TICK} minTickGap={50} />
                  <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} />
                  <Tooltip formatter={(v) => Number(v).toFixed(2)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    dataKey="portfolio"
                    name={say("This account", "本账户")}
                    stroke={seriesColor(0)}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {live.used.map((series, index) => (
                    <Line
                      key={series.key}
                      dataKey={series.key}
                      name={series.label}
                      stroke={seriesColor(index + 1)}
                      strokeDasharray={series.key === "BLEND" ? undefined : "4 3"}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { key: "portfolio", label: say("This account", "本账户") },
                ...live.used.map((s) => ({ key: s.key, label: s.label })),
              ].map((entry) => {
                const last = live.rows.at(-1)! as Record<string, number | string>;
                const value = Number(last[entry.key]) - 100;
                return (
                  <div key={entry.key}>
                    <dt className="text-xs text-muted-foreground">{entry.label}</dt>
                    <dd className={`mt-0.5 text-sm font-semibold ${value >= 0 ? "text-positive" : "text-negative"}`}>
                      {pct(value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        ) : comparison.length >= 2 ? (
          <>
            <p className="text-xs text-muted-foreground">
              {comparison[0].date} → {comparison.at(-1)?.date}
            </p>
            <ChartFrame title={say("Comparable growth", "同期增长")}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={comparison}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="date" tick={AXIS_TICK} minTickGap={50} />
                  <YAxis domain={["auto", "auto"]} tick={AXIS_TICK} />
                  <Tooltip formatter={(v) => Number(v).toFixed(2)} />
                  <Line
                    dataKey="portfolio"
                    name={say("Portfolio", "组合")}
                    stroke={seriesColor(0)}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="benchmark"
                    name={say("Benchmark", "基准")}
                    stroke={seriesColor(1)}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            {say(
              "Requires a USD portfolio, reviewed cash flows and a total-return benchmark with at least two matching dates.",
              "需要美元投资组合、已审核现金流，以及至少两个匹配日期的总回报基准。",
            )}
          </p>
        )}
      </section>
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-medium">
          {say("What it is worth in your currency", "换成你的货币是多少")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {say(
            "The account holds US dollars, but not everybody spends them. Each row is one dollar in that currency at the start and at the end, with what the whole account was worth at that rate underneath.",
            "账户里是美元，但不是每个人都花美元。每一行是一美元在期初和期末分别值多少，下面灰色的是按该汇率折算的整个账户价值。",
          )}{" "}
          {say(
            "The last column is the exchange rate on its own: how far it moved, and what that alone did to the money — nothing to do with how the investments went. A rate that weakens can take money away from a yuan holder in a year the account did well, and that is the thing worth seeing.",
            "最后一列只讲汇率本身：它变动了多少，以及仅仅因为这个变动，这笔钱多了或少了多少——与投资做得好不好无关。即使账户表现不错，汇率走弱也可能让持人民币的人少赚一截，这正是值得看清楚的地方。",
          )}{" "}
          {say("Rates: European Central Bank daily reference rates.", "汇率来源：欧洲央行每日参考汇率。")}
        </p>
        {currencyViews.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-2 text-left font-medium">
                    {say("Currency", "货币")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {say("Rate at the start", "期初汇率")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {say("Rate at the end", "期末汇率")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {say("What the rate move did", "汇率变动的影响")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {currencyViews.map((view) => (
                  <tr key={view.code} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2.5 text-left font-medium">
                      {zh ? CURRENCY_LABEL[view.code].zh : CURRENCY_LABEL[view.code].en}
                    </th>

                    {/* The rate is the figure that belongs to the currency, so
                        it leads. The amount underneath is what the account was
                        worth at that rate. */}
                    <td className="py-2.5 text-right">
                      <span className="tabular block font-medium">
                        {view.code === "USD" ? "—" : view.startRate.toFixed(4)}
                      </span>
                      <span className="tabular block text-xs text-muted-foreground">
                        {fmt(view.startValue, view.code)}
                      </span>
                    </td>

                    <td className="py-2.5 text-right">
                      <span className="tabular block font-medium">
                        {view.code === "USD" ? "—" : view.endRate.toFixed(4)}
                      </span>
                      <span className="tabular block text-xs text-muted-foreground">
                        {fmt(view.endValue, view.code)}
                      </span>
                    </td>

                    <td className="py-2.5 text-right">
                      {view.code === "USD" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span
                            className={`tabular block font-medium ${view.fromRate >= 0 ? "text-positive" : "text-negative"}`}
                          >
                            {pct(view.ratePercent)}
                          </span>
                          <span className="tabular block text-xs text-muted-foreground">
                            {fmt(view.fromRate, view.code)}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            {say(
              "Needs a US dollar account and a published exchange rate on both the first and last day of the period.",
              "需要美元账户，并且期初和期末两天都有公布的汇率。",
            )}
          </p>
        )}
      </section>
    </div>
  );
}
