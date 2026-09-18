import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { symbolSchema } from "@/lib/schemas";
import { ensureFamilySchema } from "./schema";
export type FamilyUser = {
  id: string;
  displayName: string;
  role: "owner" | "viewer";
};
const text = z.string().trim().min(1).max(2000),
  id = z.string().min(1).max(80),
  symbol = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9.-]{0,14}$/),
  date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function validImage(value: string): boolean {
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 350000) return false;
  if (match[1] === "png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (match[1] === "jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  );
}
export const familyActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("post"),
    text,
    symbol: symbolSchema.optional(),
  }),
  z.object({ action: z.literal("reply"), id, text }),
  z.object({
    action: z.literal("react"),
    id,
    reaction: z.enum(["interesting", "explain", "discuss"]),
  }),
  z.object({ action: z.literal("deletePost"), id }),
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("nominate"), symbol, text }),
  z.object({ action: z.literal("vote"), id }),
  z.object({ action: z.literal("predict"), text, revealAt: date }),
  z.object({
    action: z.literal("goal"),
    text,
    target: z.number().finite().min(0.01).max(1e9),
    imageData: z
      .string()
      .max(480000)
      .refine(validImage, "Use a PNG, JPEG, or WebP image up to 350 KB.")
      .optional(),
  }),
  z.object({
    action: z.literal("contribute"),
    id,
    amount: z.number().finite().min(0.01).max(1e7),
  }),
  z.object({ action: z.literal("challenge"), text, endsAt: date }),
  z.object({ action: z.literal("join") }),
  z.object({
    action: z.literal("trade"),
    symbol,
    side: z.enum(["buy", "sell"]),
    quantity: z.number().int().positive().max(100000),
    reason: text.optional(),
  }),
  z.object({ action: z.literal("mark") }),
  z.object({
    action: z.literal("quiz"),
    answers: z.array(z.number().int().min(0).max(2)).length(3),
  }),
]);
type Base = { id: string; userId: string; author: string; createdAt: string };
type Post = Base & {
  text: string;
  symbol?: string;
  updatedAt: string;
  replies: (Base & { text: string })[];
  reactions: Record<string, string>;
};
type Nomination = Base & {
  symbol: string;
  text: string;
  week: string;
  votes: string[];
};
type Prediction = Base & { text: string; revealAt: string };
type Goal = Base & {
  text: string;
  target: number;
  imageData?: string;
  contributions: (Base & { amount: number })[];
};
type Member = {
  userId: string;
  author: string;
  cash: number;
  holdings: Record<string, number>;
  trades: {
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    at: string;
    reason?: string;
  }[];
  observations: { at: string; value: number }[];
};
type Challenge = Base & {
  mode: "live" | "demo";
  text: string;
  endsAt: string;
  members: Member[];
  prices: Record<string, { price: number; at: string; source: string }>;
};
type State = {
  posts: Post[];
  nominations: Nomination[];
  predictions: Prediction[];
  goals: Goal[];
  challenges: Challenge[];
  read: Record<string, string>;
  quizzes: Record<string, { score: number; at: string }>;
};
function load(db: DB): State {
  ensureFamilySchema(db);
  const row = db
    .prepare("SELECT payload FROM family_state WHERE id=1")
    .get() as { payload: string } | undefined;
  return row
    ? JSON.parse(row.payload)
    : {
        posts: [],
        nominations: [],
        predictions: [],
        goals: [],
        challenges: [],
        read: {},
        quizzes: {},
      };
}
export function weekKey(now: Date) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function readFamily(db: DB, user: FamilyUser, now = new Date()) {
  const s = load(db),
    week = weekKey(now);
  const challenge = s.challenges.at(-1);
  return {
    user,
    week,
    posts: s.posts.map((p) => ({
      ...p,
      unread: p.updatedAt > (s.read[user.id] ?? ""),
    })),
    nominations: s.nominations.filter((n) => n.week === week),
    predictions: s.predictions.map((p) => ({
      ...p,
      text: p.revealAt <= now.toISOString() ? p.text : null,
    })),
    goals: s.goals.map((g) => ({
      ...g,
      saved:
        Math.round(g.contributions.reduce((a, c) => a + c.amount, 0) * 100) /
        100,
    })),
    quiz: s.quizzes[`${week}:${user.id}`] ?? null,
    challenge: challenge
      ? {
          ...challenge,
          ended: challenge.endsAt <= now.toISOString(),
          members: challenge.members.map((m) => {
            const value =
              m.cash +
              Object.entries(m.holdings).reduce(
                (n, [sym, q]) => n + q * (challenge.prices[sym]?.price ?? 0),
                0,
              );
            let peak = 10000,
              dd = 0;
            for (const o of m.observations) {
              peak = Math.max(peak, o.value);
              dd = Math.min(dd, (o.value / peak - 1) * 100);
            }
            return {
              ...m,
              value,
              returnPercent: (value / 10000 - 1) * 100,
              observedDrawdown: dd,
            };
          }),
        }
      : null,
  };
}
export type FamilyState = ReturnType<typeof readFamily>;
export function familyAction(
  db: DB,
  user: FamilyUser,
  input: unknown,
  now = new Date(),
  quote?: { price: number; source: string; dataTimestamp: string },
  quotes: {
    symbol: string;
    price: number;
    source: string;
    dataTimestamp: string;
  }[] = [],
  marketMode: "live" | "demo" = "live",
) {
  const a = familyActionSchema.parse(input);
  ensureFamilySchema(db);
  db.transaction(() => {
    const s = load(db),
      at = now.toISOString(),
      week = weekKey(now),
      base = (): Base => ({
        id: randomUUID(),
        userId: user.id,
        author: user.displayName,
        createdAt: at,
      });
    const validQuote = (
      q: { price: number; source: string; dataTimestamp: string },
      mode: "live" | "demo",
    ) =>
      Number.isFinite(q.price) &&
      q.price > 0 &&
      (mode === "demo"
        ? q.source.toLowerCase().includes("mock")
        : !q.source.toLowerCase().includes("mock")) &&
      Number.isFinite(Date.parse(q.dataTimestamp)) &&
      Math.abs(now.getTime() - Date.parse(q.dataTimestamp)) <= 15 * 60 * 1000;
    const observe = (c: Challenge) => {
      for (const m of c.members) {
        const value =
          m.cash +
          Object.entries(m.holdings).reduce(
            (n, [sym, q]) => n + q * (c.prices[sym]?.price ?? 0),
            0,
          );
        m.observations.push({ at, value });
      }
    };
    const owner = () => {
      if (user.role !== "owner") throw new Error("Only the owner can do this.");
    };
    const future = (v: string) => {
      const d = new Date(v + "T00:00:00.000Z");
      if (
        !Number.isFinite(d.getTime()) ||
        d.toISOString().slice(0, 10) !== v ||
        d <= now
      )
        throw new Error("Choose a valid future date.");
      return d.toISOString();
    };
    switch (a.action) {
      case "post":
        s.posts.unshift({
          ...base(),
          text: a.text,
          symbol: a.symbol,
          updatedAt: at,
          replies: [],
          reactions: {},
        });
        break;
      case "reply":
      case "react":
      case "deletePost": {
        const p = s.posts.find((p) => p.id === a.id);
        if (!p) throw new Error("Discussion not found.");
        if (a.action === "reply") {
          p.replies.push({ ...base(), text: a.text });
          p.updatedAt = at;
        } else if (a.action === "react") {
          if (p.reactions[user.id] === a.reaction) delete p.reactions[user.id];
          else p.reactions[user.id] = a.reaction;
        } else {
          if (p.userId !== user.id) owner();
          s.posts = s.posts.filter((p) => p.id !== a.id);
        }
        break;
      }
      case "read":
        s.read[user.id] = at;
        break;
      case "nominate":
        if (s.nominations.some((n) => n.week === week && n.symbol === a.symbol))
          throw new Error("This company is already nominated this week.");
        s.nominations.push({
          ...base(),
          symbol: a.symbol,
          text: a.text,
          week,
          votes: [],
        });
        break;
      case "vote": {
        if (
          s.nominations.some(
            (n) => n.week === week && n.votes.includes(user.id),
          )
        )
          throw new Error("You already voted this week.");
        const n = s.nominations.find((n) => n.id === a.id && n.week === week);
        if (!n) throw new Error("Nomination not found for this week.");
        n.votes.push(user.id);
        break;
      }
      case "predict":
        s.predictions.push({
          ...base(),
          text: a.text,
          revealAt: future(a.revealAt),
        });
        break;
      case "goal":
        s.goals.push({
          ...base(),
          text: a.text,
          target: a.target,
          imageData: a.imageData,
          contributions: [],
        });
        break;
      case "contribute": {
        const g = s.goals.find((g) => g.id === a.id);
        if (!g) throw new Error("Goal not found.");
        g.contributions.push({
          ...base(),
          amount: Math.round(a.amount * 100) / 100,
        });
        break;
      }
      case "quiz": {
        const key = `${week}:${user.id}`;
        if (s.quizzes[key])
          throw new Error("Quiz already completed this week.");
        s.quizzes[key] = {
          score: a.answers.reduce(
            (n, v, i) => n + (v === [1, 0, 2][i] ? 1 : 0),
            0,
          ),
          at,
        };
        break;
      }
      case "challenge":
        owner();
        if (s.challenges.at(-1)?.endsAt && s.challenges.at(-1)!.endsAt > at)
          throw new Error("A challenge is already running.");
        s.challenges.push({
          ...base(),
          mode: marketMode,
          text: a.text,
          endsAt: future(a.endsAt),
          members: [],
          prices: {},
        });
        break;
      case "mark": {
        const c = s.challenges.at(-1);
        if (!c || c.endsAt <= at) throw new Error("No active challenge.");
        const symbols = new Set(
          c.members.flatMap((m) =>
            Object.keys(m.holdings).filter((s) => m.holdings[s] > 0),
          ),
        );
        for (const sym of symbols) {
          const q = quotes.find((q) => q.symbol === sym);
          if (!q || !validQuote(q, c.mode))
            throw new Error("Fresh quotes for every holding are required.");
          c.prices[sym] = {
            price: q.price,
            at: q.dataTimestamp,
            source: q.source,
          };
        }
        observe(c);
        break;
      }
      case "join":
      case "trade": {
        const c = s.challenges.at(-1);
        if (!c || c.endsAt <= at) throw new Error("No active challenge.");
        let m = c.members.find((m) => m.userId === user.id);
        if (a.action === "join") {
          if (m) throw new Error("Already joined.");
          m = {
            userId: user.id,
            author: user.displayName,
            cash: 10000,
            holdings: {},
            trades: [],
            observations: [{ at, value: 10000 }],
          };
          c.members.push(m);
          break;
        }
        if (!m) throw new Error("Join the challenge first.");
        if (!quote || !validQuote(quote, c.mode))
          throw new Error(
            "A fresh live quote is required. Try during market hours.",
          );
        const cost = Math.round(quote.price * a.quantity * 100) / 100;
        if (a.side === "buy") {
          if (cost > m.cash) throw new Error("Not enough virtual cash.");
          m.cash = Math.round((m.cash - cost) * 100) / 100;
          m.holdings[a.symbol] = (m.holdings[a.symbol] ?? 0) + a.quantity;
        } else {
          if ((m.holdings[a.symbol] ?? 0) < a.quantity)
            throw new Error("Not enough virtual shares.");
          m.cash = Math.round((m.cash + cost) * 100) / 100;
          m.holdings[a.symbol] -= a.quantity;
        }
        m.trades.push({
          symbol: a.symbol,
          side: a.side,
          quantity: a.quantity,
          reason: a.reason,
          price: quote.price,
          at,
        });
        c.prices[a.symbol] = {
          price: quote.price,
          at: quote.dataTimestamp,
          source: quote.source,
        };
        observe(c);
        break;
      }
    }
    db.prepare(
      "INSERT INTO family_state(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    ).run(JSON.stringify(s));
  }).immediate();
  return readFamily(db, user, now);
}
