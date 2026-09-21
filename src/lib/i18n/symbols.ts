import { parseSymbol } from "@/lib/moomoo/symbols";
import type { Locale } from "./dictionaries";

/**
 * Chinese names for US-listed companies.
 *
 * A static map rather than a database table, deliberately. This is reference
 * data: it changes when a company is renamed, which is roughly never, and it
 * needs no screen to edit it. In the repository it is reviewable, versioned
 * and shipped with the code; in a table it would need a migration, an admin
 * page and a backup to achieve less.
 *
 * Deliberately partial. Every name here is the one used by Chinese financial
 * press; where no settled Chinese name exists — Nebius, Lumentum, smaller
 * tickers — the entry is omitted and the broker's own name shows instead.
 * A guessed translation reads as authoritative and is worse than English.
 */
const CHINESE_NAMES: Record<string, string> = {
  // Held in this account
  AVGO: "博通",
  GOOGL: "谷歌",
  GOOG: "谷歌",
  HPE: "慧与",
  INTC: "英特尔",
  MCD: "麦当劳",
  MRVL: "迈威尔科技",
  NOK: "诺基亚",
  NVDA: "英伟达",
  RKLB: "火箭实验室",
  VRT: "维谛技术",

  // Commonly traded, so they are ready before they are needed
  AAPL: "苹果",
  ABNB: "爱彼迎",
  AMD: "超威半导体",
  AMZN: "亚马逊",
  ASML: "阿斯麦",
  BA: "波音",
  BABA: "阿里巴巴",
  BRK: "伯克希尔",
  COIN: "Coinbase",
  COST: "好市多",
  CRM: "赛富时",
  DIS: "迪士尼",
  GS: "高盛",
  IBM: "国际商业机器",
  JD: "京东",
  JPM: "摩根大通",
  KO: "可口可乐",
  MSFT: "微软",
  MU: "美光科技",
  NFLX: "奈飞",
  NIO: "蔚来",
  ORCL: "甲骨文",
  PDD: "拼多多",
  PEP: "百事",
  PFE: "辉瑞",
  PLTR: "Palantir",
  QCOM: "高通",
  SBUX: "星巴克",
  SMCI: "超微电脑",
  TSLA: "特斯拉",
  TSM: "台积电",
  TXN: "德州仪器",
  UBER: "优步",
  V: "维萨",
  WMT: "沃尔玛",
  XPEV: "小鹏汽车",

  // Funds
  QQQ: "纳斯达克100指数ETF",
  SPY: "标普500指数ETF",
  VOO: "先锋标普500ETF",
  IWM: "罗素2000指数ETF",
};

/** Call, put and the words around a contract. */
const OPTION_WORDS = {
  call: "看涨",
  put: "看跌",
};

/**
 * The name to show beside a ticker.
 *
 * Falls back to whatever the broker returned, which for a US account is the
 * English name. An option takes its underlying's name, because that is the
 * company the position is about.
 */
export function localizedName(
  symbol: string,
  brokerName: string | undefined,
  locale: Locale,
): string | undefined {
  if (locale !== "zh") return brokerName;

  const parsed = parseSymbol(symbol);
  const root = parsed.underlyingSymbol ?? symbol;
  const chinese = CHINESE_NAMES[root.toUpperCase()];

  if (!chinese) return brokerName;
  if (parsed.instrumentType !== "option") return chinese;

  const kind = parsed.optionType ? OPTION_WORDS[parsed.optionType] : "";
  const strike = parsed.strike !== undefined ? ` ${parsed.strike}` : "";
  return `${chinese} ${kind}${strike}`.trim();
}

/** Whether a Chinese name is known, for tests and for the coverage report. */
export function hasChineseName(symbol: string): boolean {
  const parsed = parseSymbol(symbol);
  const root = (parsed.underlyingSymbol ?? symbol).toUpperCase();
  return root in CHINESE_NAMES;
}
