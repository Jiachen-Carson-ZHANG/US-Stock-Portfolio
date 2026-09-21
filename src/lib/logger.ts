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
  /\b[A-Za-z0-9_\-+/=]{28,}\b/g,
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

function emit(level: "info" | "warn" | "error", event: string, fields: LogFields) {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...scrub(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields),
};
