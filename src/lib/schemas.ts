import { z } from "zod";

export const loginSchema = z.object({
  // Stored lowercase, so "Father" and "father" are the same account.
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(512),
});

/** The only password rule: eight characters. Length resists guessing; a
 * required symbol mostly produces "Password1!". The confirmation is checked
 * in the form, not here, so the API stays one object. */
export const MIN_PASSWORD_LENGTH = 8;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(512),
});

export const activitySchema = z.object({
  kind: z.enum(["view_position", "view_page", "watchlist_add", "watchlist_remove"]),
  target: z.string().trim().max(64).optional(),
  detail: z.string().trim().max(256).optional(),
});

export const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, "Unsupported symbol");

export const quotesQuerySchema = z.object({
  symbols: z
    .string()
    .min(1)
    .max(512)
    .transform((value) => value.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(symbolSchema).min(1).max(50)),
});

export const historyRangeSchema = z.object({
  days: z.coerce.number().int().min(1).max(1825).default(180),
});

export const userIdSchema = z.string().uuid();

/**
 * A slug becomes the first segment of every URL for that portfolio, so it is
 * restricted to what survives a link: lowercase, no spaces, no punctuation
 * beyond a hyphen. Mirrors SLUG_PATTERN in @/lib/portfolios.
 */
export const createPortfolioSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z][a-z0-9-]{1,30}$/,
      "Use lowercase letters, digits and hyphens, starting with a letter",
    ),
  displayName: z.string().trim().min(1).max(60),
  ownerUserId: z.string().uuid(),
  kind: z.enum(["broker", "mock"]),
  // Only meaningful for a mock portfolio; a broker one takes its opening
  // position from the cash-flow ledger.
  openingCash: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 10000")
    .optional(),
});

/**
 * Whole shares only, and a sane upper bound. Fractional paper shares would
 * not match how the real account trades, which is the thing being compared.
 */
export const mockTradeSchema = z.object({
  side: z.enum(["buy", "sell"]),
  symbol: symbolSchema,
  quantity: z.number().int().positive().max(1_000_000),
});

/**
 * The username becomes a URL segment on approval, so it is constrained to
 * what survives a link from the moment it is chosen rather than being
 * rejected later.
 */
export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z][a-z0-9-]{1,30}$/,
      "Use lowercase letters, digits and hyphens, starting with a letter",
    ),
  displayName: z.string().trim().min(1).max(60),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(512),
  referredBy: z.string().trim().max(60).default(""),
  // Written rather than chosen, and required: a sentence in somebody's own
  // words tells whoever approves far more than a tick-box, and a blank one
  // tells them nothing at all.
  reason: z
    .string()
    .trim()
    .min(10, "Say a little about why you would like to join")
    .max(500),
  email: z
    .string()
    .trim()
    .email("That does not look like an email address")
    .max(160)
    .optional()
    .or(z.literal("")),
});

export const accountDecisionSchema = z.object({
  userId: z.string().uuid(),
  approve: z.boolean(),
});

export const accessRequestSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1).max(32),
  message: z.string().trim().max(280).default(""),
});

export const accessDecisionSchema = z.object({
  requestId: z.string().uuid(),
  approve: z.boolean(),
});

/**
 * An order ticket. Whole shares only, matching how the real account trades —
 * fractional paper shares would not compare.
 */
export const placeOrderSchema = z
  .object({
    symbol: symbolSchema,
    side: z.enum(["buy", "sell"]),
    kind: z.enum(["market", "limit", "stop"]),
    quantity: z.number().int().positive().max(1_000_000),
    limitPrice: z.number().positive().max(1_000_000).optional(),
    stopPrice: z.number().positive().max(1_000_000).optional(),
    timeInForce: z.enum(["day", "gtc"]).default("day"),
  })
  .refine((order) => order.kind !== "limit" || order.limitPrice !== undefined, {
    message: "A limit order needs a limit price",
    path: ["limitPrice"],
  })
  .refine((order) => order.kind !== "stop" || order.stopPrice !== undefined, {
    message: "A stop order needs a stop price",
    path: ["stopPrice"],
  });

export const cancelOrderSchema = z.object({ orderId: z.string().uuid() });

export const portfolioAccessSchema = z.object({
  portfolioId: z.string().uuid(),
  userId: z.string().uuid(),
  grant: z.boolean(),
});

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/, "Unsupported query"),
});

export const watchlistAddSchema = z.object({
  symbol: symbolSchema,
  name: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(3).max(1000),
});

export const watchlistRemoveSchema = z.object({ symbol: symbolSchema });

export const aiSchema = z.object({
  mode: z.enum(["view", "rewrite"]),
  symbol: symbolSchema.optional(),
  name: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(1000).optional(),
  draft: z.string().trim().max(2000).optional(),
});
