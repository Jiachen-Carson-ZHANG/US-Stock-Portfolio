type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * Field names that must never reach the log stream (§30). Values are dropped
 * rather than masked so a careless caller cannot leak length or prefix either.
 */
const FORBIDDEN = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "sessiontoken",
  "accountnumber",
]);

function scrub(fields: LogFields): LogFields {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN.has(key.toLowerCase().replace(/[^a-z]/g, ""))) continue;
    safe[key] = value;
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
