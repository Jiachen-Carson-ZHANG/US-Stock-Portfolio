/**
 * Recognising "this tab is running code from an older deployment".
 *
 * The symptom is always the same family of errors: a script file that the
 * current deployment no longer has, or a server response the old code cannot
 * read. None of them is fixed by trying again with the same code, which is
 * why "Try again" used to do nothing. All of them are fixed by one reload.
 */
const STALE_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /Failed to find Server Action/i,
  /unexpected response was received from the server/i,
];

export function looksLikeStaleCode(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return STALE_PATTERNS.some((pattern) => pattern.test(text));
}

const RELOADED_AT = "stale-code-reloaded-at";

/**
 * Reload once, and only once in a short while.
 *
 * If the reload itself does not fix it — the deployment is genuinely broken,
 * say — reloading again in a loop would turn one error into a flickering page
 * nobody can read or leave. So a second attempt within half a minute is
 * refused and the error screen is shown instead.
 */
export function reloadOnceForStaleCode(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_AT) ?? "0");
    if (Date.now() - last < 30_000) return false;
    window.sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    // Private browsing can refuse storage. Reload anyway; the loop guard is
    // a courtesy, and a stale tab is the more likely case by far.
  }
  window.location.reload();
  return true;
}

/**
 * Tells the server that something failed in this browser.
 *
 * Without it the log is blind to exactly the failures people see most: the
 * server answered correctly, and the page broke anyway. Sent with keepalive so
 * it survives the reload that stale code triggers straight afterwards, and
 * capped per page so a loop cannot flood the log.
 */
let sent = 0;

export function reportClientError(
  kind: string,
  error: unknown,
  digest?: string,
): void {
  if (sent >= 5) return;
  sent += 1;

  try {
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
    void fetch("/api/client-errors", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        message: message.slice(0, 300),
        digest,
        path: window.location.pathname,
        build: document.documentElement.dataset.dplId ?? "unknown",
        agent: navigator.userAgent.slice(0, 120),
      }),
    }).catch(() => {});
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}
