import { z } from "zod";

export const loginSchema = z.object({
  // Stored lowercase, so "Father" and "father" are the same account.
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(512),
});

/**
 * A minimum length rather than a character-class rule: length is what actually
 * resists guessing, and forcing a symbol mostly produces "Password1!". The
 * confirmation is checked in the form, not here, so the API stays one object.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(10, "Use at least 10 characters").max(512),
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
  kind: z.enum(["broker", "paper"]),
  // Only meaningful for a paper portfolio; a broker one takes its opening
  // position from the cash-flow ledger.
  openingCash: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 10000")
    .optional(),
});

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
