import type { StrategyKey } from "@/lib/options/strategies";

/**
 * The strategies, by what somebody wants rather than what they are called.
 * The jargon name is kept underneath, because it is what every other app and
 * article uses, and knowing it is how somebody learns more.
 */
export const STRATEGY: Record<StrategyKey, { en: [string, string, string]; zh: [string, string, string]; income: boolean }> = {
  "sell-put": {
    en: ["Get paid to wait for a lower price", "Sell a put", "Collect money now. If the share falls below the strike you buy it there, so pick a share and a price you would be glad to own."],
    zh: ["等更低的价格买入，先收一笔钱", "卖出看跌期权", "现在就收钱。如果股价跌破行权价，你要按行权价买入，所以要选你本来就愿意在那个价位持有的股票。"],
    income: true,
  },
  "covered-call": {
    en: ["Earn on shares you already own", "Covered call", "For every 100 shares you hold, sell a call above today's price. You keep the money; if the share rises past the strike, your shares are sold there."],
    zh: ["用已持有的股票赚额外收入", "备兑看涨", "每持有 100 股，卖出一张高于现价的看涨期权。收到的钱归你；如果股价涨过行权价，股票会按行权价被卖出。"],
    income: true,
  },
  "bull-put-spread": {
    en: ["Get paid if it stays above a price", "Bull put spread", "Sell a put and buy a cheaper one below it. You collect money now, and the second put caps how much you can lose."],
    zh: ["只要股价守在某个价位之上就赚钱", "牛市看跌价差", "卖出一张看跌期权，再买入一张更低行权价的看跌期权。现在收钱，第二张期权限定了最大亏损。"],
    income: true,
  },
  "bear-call-spread": {
    en: ["Get paid if it stays below a price", "Bear call spread", "Sell a call and buy a cheaper one above it. You collect money now, and the second call caps how much you can lose."],
    zh: ["只要股价不涨过某个价位就赚钱", "熊市看涨价差", "卖出一张看涨期权，再买入一张更高行权价的看涨期权。现在收钱，第二张期权限定了最大亏损。"],
    income: true,
  },
  "buy-call": {
    en: ["Bet it goes up", "Buy a call", "The most you can lose is what you pay. The share has to rise past the break-even before expiry for it to make money."],
    zh: ["押注上涨", "买入看涨期权", "最多亏掉付出的钱。到期前股价要涨过保本价才赚钱。"],
    income: false,
  },
  "buy-put": {
    en: ["Bet it goes down, or protect shares", "Buy a put", "The most you can lose is what you pay. It gains as the share falls below the break-even, and it is also used as insurance on shares you hold."],
    zh: ["押注下跌，或给持股买保险", "买入看跌期权", "最多亏掉付出的钱。股价跌破保本价时开始赚钱，也可以当作持股的保险。"],
    income: false,
  },
  "bull-call-spread": {
    en: ["Bet it goes up, for less", "Bull call spread", "Buy a call and sell a higher one. Cheaper than a call alone, in exchange for a ceiling on what it can make."],
    zh: ["押注上涨，但花得更少", "牛市看涨价差", "买入一张看涨期权，同时卖出一张更高行权价的。比单买看涨便宜，代价是收益有上限。"],
    income: false,
  },
  "bear-put-spread": {
    en: ["Bet it goes down, for less", "Bear put spread", "Buy a put and sell a lower one. Cheaper than a put alone, in exchange for a ceiling on what it can make."],
    zh: ["押注下跌，但花得更少", "熊市看跌价差", "买入一张看跌期权，同时卖出一张更低行权价的。比单买看跌便宜，代价是收益有上限。"],
    income: false,
  },
};

export const ORDER: StrategyKey[] = [
  "sell-put", "covered-call", "bull-put-spread", "bear-call-spread",
  "buy-call", "buy-put", "bull-call-spread", "bear-put-spread",
];
