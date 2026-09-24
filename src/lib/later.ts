import { after } from "next/server";

/**
 * Work that should happen, but should not make anybody wait for it.
 *
 * The obvious way to write that — start the promise and do not await it — is
 * wrong on a serverless host. The platform freezes the function the moment
 * the response is sent, and whatever was still running is never resumed. It
 * looks fine locally, where the process lives on, and silently drops work in
 * production.
 *
 * That is exactly what happened to prices. A stale quote was served at once
 * with its refresh started in the background, and the background refresh was
 * frozen along with everything else. The scheduler took the same path, so for
 * most of a day prices did not refresh at all — while the screen promised a
 * refresh was on its way. Log writes, error reports and background syncs were
 * all written the same way and all at the same risk.
 *
 * `after` tells the platform to keep the function alive until the work is
 * done, up to the route's time limit. Outside a request — a test, a script —
 * there is no platform to tell, and the work simply runs.
 */
export function runLater(work: () => Promise<unknown>): void {
  const guarded = async () => {
    try {
      await work();
    } catch {
      // Background work reports its own failures where it needs to. An
      // exception escaping here would only be an unhandled rejection.
    }
  };

  try {
    after(guarded);
  } catch {
    // Not inside a request, so nothing will freeze it.
    void guarded();
  }
}
