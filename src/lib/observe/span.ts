import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Where the current request's time is going.
 *
 * Kept in its own module with no imports of its own, because both the
 * database layer and the observer need it and neither may import the other —
 * the database cannot depend on the thing that writes to the database.
 */
export type Span = { db: number; broker: number };

export const currentSpan = new AsyncLocalStorage<Span>();

/**
 * Times one call and files it under a bucket.
 *
 * A call that throws still had its time spent, so the clock stops in a
 * `finally`: a breakdown that only counted successes would make a failing
 * broker look instant.
 */
export async function timed<T>(kind: keyof Span, work: () => Promise<T>): Promise<T> {
  const span = currentSpan.getStore();
  if (!span) return work();

  const started = Date.now();
  try {
    return await work();
  } finally {
    span[kind] += Date.now() - started;
  }
}
