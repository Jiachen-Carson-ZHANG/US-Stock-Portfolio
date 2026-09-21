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
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  adjustedSeries,
  analysisStats,
  benchmarkComparison,
  fxDecomposition,
  monthlyReturns,
} from "@/lib/analysis/math";
import type { AnalysisData } from "@/lib/analysis/store";
import type { PortfolioSnapshot } from "@/types/portfolio";

export function PerformanceExplorer({
  snapshots,
  initial,
  owner,
  currency,
}: {
  snapshots: PortfolioSnapshot[];
  initial: AnalysisData;
  owner: boolean;
  currency: string;
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
  const months = monthlyReturns(result, data.flows);
  const comparison =
    currency === "USD"
      ? benchmarkComparison(result.points, data.benchmark)
      : [];
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
          { name: say("Start", "期初"), range: [0, start], amount: start },
          {
            name: say("Net flows", "净转入"),
            range: [Math.min(start, flowEnd), Math.max(start, flowEnd)],
            amount: result.netFlows,
          },
          {
            name: say("Gain / loss", "投资损益"),
            range: [Math.min(flowEnd, end), Math.max(flowEnd, end)],
            amount: result.gain,
          },
          { name: say("End", "期末"), range: [0, end], amount: end },
        ];
  const fxStart = data.fx.find((r) => r.date === first?.snapshotDate)?.value;
  const fxEnd = data.fx.find((r) => r.date === last?.snapshotDate)?.value;
  const fx =
    currency === "USD" && fxStart && fxEnd
      ? fxDecomposition(start, end, fxStart, fxEnd)
      : null;
  async function save(body: unknown) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setStatus("");
    setFailed(false);
    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {first?.snapshotDate ?? "—"} → {last?.snapshotDate ?? "—"} ·{" "}
          {selected.length} {say("observations", "次记录")}
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
          <p className="text-xs text-muted-foreground">
            {say(
              "Cash-flow-adjusted returns; deposits and withdrawals assumed at end of day. Drawdown uses observed valuations.",
              "已调整现金流的收益率；假设转入和转出发生在每日结束时。回撤基于已记录的估值。",
            )}
            {!result.daily &&
              " " +
                say(
                  "Missing weekdays: daily statistics are withheld.",
                  "缺少工作日数据：不显示每日统计。",
                )}
          </p>
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
              "Cash-flow-adjusted portfolio index.",
              "调整现金流后的投资组合指数。",
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
                  {say("intervals", "个区间")} · {pct(m.percent)} ·{" "}
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
            "Imported total-return index, including reinvested dividends; matching dates only. Both series start at 100 on their first shared date.",
            "导入含股息再投资的总回报指数，仅使用日期匹配的数据。两条曲线在首个共同日期从 100 起步。",
          )}{" "}
          {data.sources.benchmark}
        </p>
        {comparison.length >= 2 ? (
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
          {say("The RMB perspective", "人民币视角")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {say(
            "Account-value change, including deposits and withdrawals; not investment return. USD changes use the starting exchange rate; FX effect includes the interaction.",
            "账户价值变化包含转入和转出，并非投资收益率。美元价值变化按期初汇率折算；汇率影响包含交叉项。",
          )}{" "}
          {data.sources.fx}
        </p>
        {fx ? (
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              [say("USD value change", "美元价值变化"), fx.investment],
              [say("Exchange-rate effect", "汇率影响"), fx.currency],
              [say("Total RMB change", "人民币总变化"), fx.total],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {fmt(Number(value), "CNY")}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {say(
              "Requires a USD portfolio and USD/CNY observations on both selected endpoint dates.",
              "需要美元投资组合以及所选期初和期末日期的美元兑人民币汇率。",
            )}
          </p>
        )}
      </section>
      {owner && (
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
              {say("Import dated observations", "导入日期数据")}
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
              {say("Import observations", "导入数据")}
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
      )}
    </div>
  );
}
