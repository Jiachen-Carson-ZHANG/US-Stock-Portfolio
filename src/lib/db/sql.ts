/**
 * Postgres numbers its placeholders ($1, $2) where SQLite numbers nothing (?).
 * Rewriting sixty-odd statements by hand invites the one bug class this app can
 * least afford — a silently transposed parameter — so the conversion is done
 * here, once, and tested.
 */
export function toPositionalParams(sql: string): string {
  let out = "";
  let index = 0;
  let placeholder = 0;

  while (index < sql.length) {
    const char = sql[index];

    // A '?' inside a literal, an identifier or a comment is data, not a
    // placeholder, so those regions are copied through untouched.
    if (char === "'" || char === '"') {
      const quote = char;
      out += quote;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote && sql[index + 1] === quote) {
          out += quote + quote;
          index += 2;
          continue;
        }
        if (sql[index] === quote) {
          out += quote;
          index += 1;
          break;
        }
        out += sql[index];
        index += 1;
      }
      continue;
    }

    if (char === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        out += sql[index];
        index += 1;
      }
      continue;
    }

    if (char === "?") {
      placeholder += 1;
      out += `$${placeholder}`;
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}
