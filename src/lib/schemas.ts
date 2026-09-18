import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(512),
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
