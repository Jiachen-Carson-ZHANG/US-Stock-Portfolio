"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Help } from "@/components/ui/help";
import { Input } from "@/components/ui/field";
import { useLocale } from "@/lib/i18n/context";
import { defaultSure, type DatedCandidate, type ScreenSort, type StrategyKey } from "@/lib/options/strategies";
import { cn } from "@/lib/utils";
import type { OptionExpiration } from "@/types/market";
import { CandidateCard } from "./candidate-card";
import { ORDER, STRATEGY } from "./strategy-text";

type Answer = {
  candidates?: DatedCandidate[];
  expiries?: number;
  contracts?: number;
  error?: string;
  reason?: string;
};

const HORIZONS = [30, 60, 120, 365] as const;
const SURE = [0.9, 0.8, 0.7, 0.6, 0.5, 0.35, 0.25] as const;

/**
 * The screener: every expiry and strike searched for the trades that fit a
 * goal, ranked on one scale.
 *
 * The chain is for looking at contracts one date at a time. This does the
 * reading for you: it prices each date's contracts within the horizon, builds
 * every trade the goal allows, drops the ones less likely to profit than you
 * asked, and ranks the rest. The two everyday choices are plain fields; the
 * settings that need explaining are under "More options", each with its own
 * question mark.
 */
export function StrategyFinder({
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
  const [strategy, setStrategy] = useState<StrategyKey>("sell-put");
  const [horizon, setHorizon] = useState<number>(60);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [sure, setSure] = useState<number>(defaultSure("sell-put"));
  const [sort, setSort] = useState<ScreenSort>("best");
  const [result, setResult] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);

  const info = STRATEGY[strategy];
  const [, name, explanation] = zh ? info.zh : info.en;
  // Money collected now, so the cash it ties up is worth showing.
  const collects = info.income || strategy === "bull-put-spread" || strategy === "bear-call-spread";

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const range = [
        Number(min) > 0 ? `&min=${Number(min)}` : "",
        Number(max) > 0 ? `&max=${Number(max)}` : "",
      ].join("");
      void fetch(
        `/api/options/screen?portfolio=${encodeURIComponent(portfolioSlug)}&symbol=${encodeURIComponent(symbol)}&expiry=all&days=${horizon}&strategy=${strategy}&sure=${sure}&sort=${sort}${range}`,
      )
        .then((response) => response.json())
        .then((body: Answer) => {
          if (!cancelled) setResult(body);
        })
        .catch(() => {
          if (!cancelled) setResult({ error: "offline" });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [portfolioSlug, symbol, strategy, horizon, sure, sort, min, max]);

  const field = "min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base";
  const reachable = expirations.filter((row) => row.days <= horizon).length;

  const chip = (active: boolean) =>
    cn(
      "min-h-9 rounded-lg border px-3 text-xs",
      active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted",
    );

  const RANKING: Record<ScreenSort, string> = {
    best: collects
      ? say("Most income per year", "年化收入最高")
      : strategy.endsWith("spread")
        ? say("Most to gain for each dollar at risk", "每冒一美元风险赚得最多")
        : say("Cheapest", "成本最低"),
    chance: say("Most likely to profit", "盈利概率最高"),
    income: say("Most income per year", "年化收入最高"),
    cheapest: say("Least money tied up", "占用资金最少"),
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Search className="size-4" aria-hidden="true" />
        {say(
          "Pick a goal. Every expiry and strike is searched and the best matches are listed, so nothing has to be read by eye.",
          "选择一个目标。系统会搜索所有到期日和行权价，列出最合适的交易，不用你一个个去看。",
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {say("What do you want?", "你想要什么？")}
            <Help title={say("The goals", "各个目标")}>
              {ORDER.map((key) => {
                const [title, jargon, why] = zh ? STRATEGY[key].zh : STRATEGY[key].en;
                return (
                  <span key={key} className="mb-2 block">
                    <strong className="font-medium text-foreground">{title}</strong> ({jargon}). {why}
                  </span>
                );
              })}
            </Help>
          </span>
          <select
            aria-label={say("What do you want?", "你想要什么？")}
            value={strategy}
            onChange={(event) => {
              const next = event.target.value as StrategyKey;
              setStrategy(next);
              setSure(defaultSure(next));
            }}
            className={cn(field, "mt-1.5")}
          >
            {ORDER.map((key) => (
              <option key={key} value={key}>
                {(zh ? STRATEGY[key].zh : STRATEGY[key].en)[0]}
              </option>
            ))}
          </select>
        </label>

        <div className="text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {say("Expiring within", "多久之内到期")}
            <Help title={say("Expiring within", "多久之内到期")}>
              {say(
                "How far ahead to look. Every expiry up to this many days away is searched, ten at most, and the results can come from any of them.",
                "要往后看多远。这么多天以内的所有到期日都会被搜索，最多十个，结果可能来自其中任何一个。",
              )}
            </Help>
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group">
            {HORIZONS.map((days) => (
              <button key={days} type="button" aria-pressed={horizon === days} onClick={() => setHorizon(days)} className={chip(horizon === days)}>
                {days === 365 ? say("A year", "一年") : `${days} ${say("days", "天")}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{name}.</span> {explanation}
      </p>

      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">{say("More options", "更多选项")}</summary>
        <div className="mt-3 space-y-4">
          <div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {say("How likely to profit, at least", "盈利概率至少")}
              <Help title={say("How likely to profit", "盈利概率")}>
                {say(
                  "Only trades at least this likely to end in profit are shown, judged from today's option prices and assuming you hold to expiry. For money collected now, asking for more certainty means less income, because the market pays more for more risk. For a bet on a move, a lower figure allows cheaper trades that pay more when they come off.",
                  "只显示至少有这么大概率盈利的交易，按今天的期权价格推算，并假设持有到期。对于先收钱的交易，要求越有把握，收入越少，因为市场只为更高的风险付更多的钱。对于押注涨跌的交易，调低这个数字可以看到更便宜、赚得也更多的交易。",
                )}
              </Help>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group">
              {SURE.map((value) => (
                <button key={value} type="button" aria-pressed={sure === value} onClick={() => setSure(value)} className={chip(sure === value)}>
                  {`${Math.round(value * 100)}%`}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              {say("Rank by", "排序方式")}
              <Help title={say("Rank by", "排序方式")}>
                {say(
                  "Best match ranks money collected now by income per year for the cash it ties up, a spread bought for a move by how much it can make for each dollar it can lose, and a single bought option by how little it costs. The other choices rank everything by that one thing.",
                  "「最佳匹配」对于先收钱的交易按占用资金的年化收入排序，对于押注涨跌的价差按每冒一美元风险能赚多少排序，对于单独买入的期权按成本从低到高排序。其他选项则全部按所选的那一项排序。",
                )}
              </Help>
            </span>
            <select aria-label={say("Rank by", "排序方式")} value={sort} onChange={(event) => setSort(event.target.value as ScreenSort)} className={cn(field, "mt-1.5 sm:max-w-xs")}>
              <option value="best">{say("Best match", "最佳匹配")}</option>
              <option value="chance">{say("Most likely to profit", "盈利概率最高")}</option>
              <option value="income">{say("Most income per year", "年化收入最高")}</option>
              <option value="cheapest">{say("Least money tied up", "占用资金最少")}</option>
            </select>
          </label>

          <div>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {say("Strikes between", "行权价范围")}
              <Help title={say("Strikes between", "行权价范围")}>
                {say(
                  "Leave empty to search the strikes nearest today's price. Fill it in to search only strikes inside the range, for example the prices at which you would be glad to buy the share.",
                  "留空时搜索离现价最近的行权价。填写后只搜索这个范围内的行权价，比如你愿意买入这只股票的价位。",
                )}
              </Help>
            </p>
            <div className="mt-1.5 flex items-center gap-2 sm:max-w-md">
              <Input inputMode="decimal" placeholder={say("from", "从")} value={min} onChange={(event) => setMin(event.target.value)} />
              <span className="text-muted-foreground">{say("to", "至")}</span>
              <Input inputMode="decimal" placeholder={say("to", "到")} value={max} onChange={(event) => setMax(event.target.value)} />
            </div>
          </div>
        </div>
      </details>

      <section aria-live="polite" className="space-y-2">
        {loading && !result ? (
          <p className="text-sm text-muted-foreground">
            {say(`Searching ${reachable} expiries…`, `正在搜索 ${reachable} 个到期日…`)}
          </p>
        ) : result?.error ? (
          <p className="text-sm text-negative">
            {result.error === "offline" ? say("Could not reach the site.", "连不上网站。") : result.error} {result.reason}
          </p>
        ) : result?.candidates && result.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {say(
              "Nothing fits. Try a longer horizon, a lower chance under More options, or a wider strike range.",
              "没有合适的交易。可以把时间放长一些，在「更多选项」里降低概率要求，或放宽行权价范围。",
            )}
          </p>
        ) : (
          <>
            {result?.candidates && result.candidates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {say(
                  `Searched ${result.expiries ?? 0} expiries and ${result.contracts ?? 0} contracts. Showing the ${result.candidates.length} best, ranked by ${RANKING[sort].toLowerCase()}, among trades at least ${Math.round(sure * 100)}% likely to profit.`,
                  `已搜索 ${result.expiries ?? 0} 个到期日、${result.contracts ?? 0} 张合约。按「${RANKING[sort]}」排序，列出盈利概率至少 ${Math.round(sure * 100)}% 的前 ${result.candidates.length} 个交易。`,
                )}
              </p>
            )}
            {result?.candidates?.map((c) => (
              <CandidateCard
                key={`${c.expiry}:${c.legs.map((l) => l.symbol).join("+")}`}
                candidate={c}
                symbol={symbol}
                spot={spot}
                expiry={c.expiry}
                days={c.days}
                income={collects}
                tradeSlug={tradeSlug}
                dimmed={loading}
                payoff={strategy !== "covered-call"}
              />
            ))}
          </>
        )}
      </section>
    </div>
  );
}
