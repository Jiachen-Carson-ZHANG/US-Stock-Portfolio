/**
 * One piece of work per key, however many callers ask for it.
 *
 * The problem this solves is visible in the logs: two requests arriving 31ms
 * apart each refreshed the broker token, because neither knew the other was
 * already doing it. With ten people on the dashboard that is ten round trips
 * to fetch one answer, and every one of them is latency somebody is waiting
 * on.
 *
 * Per process, which is the right scope: it deduplicates the concurrency a
 * single instance actually has, and needs no coordination to do it.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const started = work().finally(() => {
    // Cleared on settle, not on success: a failed fetch should be retried by
    // the next caller rather than cached as a rejection.
    inFlight.delete(key);
  });

  inFlight.set(key, started);
  return started;
}

/** For tests, which must not inherit another test's in-flight work. */
export function clearInflight(): void {
  inFlight.clear();
}
