import { z } from "zod";

export const loginSchema = z.object({
  // Stored lowercase, so "Father" and "father" are the same account.
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(512),
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
