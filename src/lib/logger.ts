type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * Field names that must never reach the log stream (§30). Values are dropped
 * rather than masked so a careless caller cannot leak length or prefix either.
 */
const FORBIDDEN = new Set([
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "tokenhash",
  "authorization",
  "cookie",
  "secret",
  "apikey",
  "clientsecret",
  "encryptionkey",
  "iv",
  "authtag",
  "accountnumber",
  "accountid",
]);

/**
 * A secret can also arrive inside a value nobody thought of as secret — most
 * often a provider's error text quoting the request it rejected. Field names
 * cannot catch that, so three shapes are redacted wherever they appear.
 *
 * Deliberately blunt. Losing a stack frame from a log line costs an afternoon;
 * printing a live refresh token costs the account.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Anything introduced as a credential, however it is punctuated:
  // "refresh_token=ya29…", "Authorization: Bearer …", "api key: …".
  /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|bearer|secret|api[_-]?key|password|authorization)\s*[:=]?\s+|(?:token|secret|key|password)\s*=\s*)(\S+)/gi,
  // A JWT, whose individual segments are too short for the length rule below.
  /\beyJ[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+){0,2}/g,
  // Anything else long enough to be a credential and shaped like one.
  //
  // A digit is required. Without that condition this swallowed
  // "idx_broker_connection_portfolio" out of a Postgres error and turned a
  // one-line diagnosis into an afternoon. Credentials are base64, hex or
  // random and essentially always carry one; identifiers usually do not.
  /\b(?=[A-Za-z0-9_\-+/=]*\d)[A-Za-z0-9_\-+/=]{28,}\b/g,
];

function redactValue(value: string): string {
  let out = value;
  out = out.replace(SECRET_PATTERNS[0], (_match, label: string) => `${label}[redacted]`);
  out = out.replace(SECRET_PATTERNS[1], "[redacted]");
  out = out.replace(SECRET_PATTERNS[2], "[redacted]");
  return out;
}

function scrub(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN.has(key.toLowerCase().replace(/[^a-z]/g, ""))) continue;
    safe[key] = typeof value === "string" ? redactValue(value) : value;
  }
  return safe;
}

/**
 * Errors also go where an owner can read them.
 *
 * The console is the hosting provider's log, which nobody here can open from
 * the site — so every handled failure (an order the broker refused, a sync
 * that timed out) was recorded somewhere invisible. Errors are now copied into
 * the same table the Speed and activity page reads.
 *
 * Only errors: warnings and info are routine, and copying them would bury the
 * lines that matter. Already scrubbed of secrets by the time they get here.
 * Loaded lazily so the logger keeps no import of the database — the database
 * layer logs too, and the two must not depend on each other at load time.
 */
function persist(event: string, fields: LogFields): void {
  // Only on the server; a stray import in the browser has no database.
  if (typeof window !== "undefined") return;

  const detail = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" · ")
    .slice(0, 300);

  // Loaded lazily, and run through `after` so the platform does not freeze
  // it half-written once the response is out.
  void import("@/lib/later")
    .then(({ runLater }) =>
      runLater(() =>
        import("@/lib/observe").then(({ recordFailure }) =>
          recordFailure(`server ${event}`, detail),
        ),
      ),
    )
    .catch(() => {
      // The copy is a convenience. The console line above is the record.
    });
}

function emit(level: "info" | "warn" | "error", event: string, fields: LogFields) {
  const safe = scrub(fields);
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...safe,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  if (level === "error") persist(event, safe);
}

export const logger = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields),
};
