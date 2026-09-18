import { Pool, type PoolClient } from "pg";
import { toPositionalParams } from "./sql";

export type RunResult = { changes: number };

/**
 * The query surface the app codes against. It mirrors the shape the SQLite
 * layer exposed (get / all / run / transaction) so call sites read the same;
 * the difference is that every method is now asynchronous.
 */
export type DB = {
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','viewer')),
  created_at    TEXT NOT NULL,
  disabled_at   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS activity_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  username   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_target ON activity_events(kind, target);

CREATE TABLE IF NOT EXISTS login_attempts (
  username     TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(username, attempted_at);

CREATE TABLE IF NOT EXISTS broker_connections (
  id                      TEXT PRIMARY KEY,
  provider                TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  iv                      TEXT NOT NULL,
  auth_tag                TEXT NOT NULL,
  scope                   TEXT NOT NULL,
  account_id              TEXT,
  connected_at            TEXT NOT NULL,
  last_refresh_at         TEXT,
  status                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id                  TEXT PRIMARY KEY,
  broker              TEXT NOT NULL,
  instrument_type     TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  underlying_symbol   TEXT,
  name                TEXT,
  sector              TEXT,
  quantity            DOUBLE PRECISION NOT NULL,
  average_cost        DOUBLE PRECISION,
  currency            TEXT NOT NULL,
  option_type         TEXT,
  strike              DOUBLE PRECISION,
  expiration_date     TEXT,
  contract_multiplier DOUBLE PRECISION,
  reported_price           DOUBLE PRECISION,
  reported_market_value    DOUBLE PRECISION,
  reported_unrealized_pnl  DOUBLE PRECISION,
  reported_today_pnl       DOUBLE PRECISION,
  reported_realized_pnl    DOUBLE PRECISION,
  synced_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  deal_id    TEXT PRIMARY KEY,
  order_id   TEXT,
  side       TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  name       TEXT,
  quantity   DOUBLE PRECISION NOT NULL,
  price      DOUBLE PRECISION NOT NULL,
  amount     DOUBLE PRECISION NOT NULL,
  traded_at  TEXT NOT NULL,
  synced_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_time ON transactions(traded_at DESC);

CREATE TABLE IF NOT EXISTS watchlist (
  id         TEXT PRIMARY KEY,
  symbol     TEXT NOT NULL UNIQUE,
  name       TEXT,
  reason     TEXT NOT NULL,
  added_by   TEXT NOT NULL,
  ai_note    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_cache (
  symbol         TEXT PRIMARY KEY,
  price          DOUBLE PRECISION NOT NULL,
  previous_close DOUBLE PRECISION NOT NULL,
  change         DOUBLE PRECISION NOT NULL,
  change_percent DOUBLE PRECISION NOT NULL,
  market_status  TEXT NOT NULL,
  data_timestamp TEXT NOT NULL,
  source         TEXT NOT NULL,
  cached_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id                    TEXT PRIMARY KEY,
  snapshot_date         TEXT NOT NULL UNIQUE,
  total_market_value    TEXT NOT NULL,
  total_cost            TEXT NOT NULL,
  total_unrealized_pnl  TEXT NOT NULL,
  cash_value            TEXT NOT NULL,
  positions_json        TEXT NOT NULL,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_notes (
  id         TEXT PRIMARY KEY,
  symbol     TEXT NOT NULL REFERENCES watchlist(symbol) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watchlist_notes_symbol ON watchlist_notes(symbol);

-- A single-row document: the family challenge is read and rewritten whole, so
-- normalising it would buy nothing.
CREATE TABLE IF NOT EXISTS family_state (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_flows (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  amount     DOUBLE PRECISION NOT NULL,
  note       TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_observations (
  kind  TEXT NOT NULL,
  date  TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (kind, date)
);

-- Columns introduced after the first release. Postgres supports IF NOT EXISTS
-- here, so the SQLite era's PRAGMA-driven migration helper is no longer needed.
ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_price DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_market_value DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_unrealized_pnl DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_today_pnl DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_realized_pnl DOUBLE PRECISION;
`;

/** Identifies our schema lock so two booting containers cannot race each other. */
const SCHEMA_LOCK_KEY = "8164207311002911";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a Postgres instance, e.g. " +
        "postgres://user:password@host:5432/portfolio",
    );
  }
  if (url.startsWith("file:")) {
    throw new Error(
      `DATABASE_URL still points at a SQLite file (${url}). This app now runs ` +
        "on Postgres — see README.md for the connection string format.",
    );
  }
  return url;
}

/**
 * Managed providers terminate TLS with certificates that do not always chain to
 * a root Node ships with, which is why `no-verify` exists as an escape hatch.
 * It encrypts the connection but skips chain validation, so it is a fallback,
 * not the default.
 */
function sslOption(url: string) {
  const mode = process.env.DATABASE_SSL;
  if (mode === "off") return undefined;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  if (mode === "on") return { rejectUnauthorized: true };
  return /[?&]sslmode=(require|verify-ca|verify-full)/.test(url)
    ? { rejectUnauthorized: true }
    : undefined;
}

function wrap(runner: {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
}): Omit<DB, "transaction"> {
  return {
    async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      const result = await runner.query(toPositionalParams(sql), params);
      return result.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await runner.query(toPositionalParams(sql), params);
      return result.rows as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
      const result = await runner.query(toPositionalParams(sql), params);
      return { changes: result.rowCount ?? 0 };
    },
    async exec(sql: string): Promise<void> {
      await runner.query(sql);
    },
  };
}

function fromPool(pool: Pool): DB {
  return {
    ...wrap(pool),
    async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(fromClient(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Inside a transaction every statement must travel down the same connection,
 * so a nested transaction() reuses this client rather than checking out another
 * from the pool — taking a second connection there is a classic self-deadlock.
 */
function fromClient(client: PoolClient): DB {
  return {
    ...wrap(client),
    async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
      return fn(fromClient(client));
    },
  };
}

let pool: Pool | null = null;
let ready: Promise<DB> | null = null;

async function initialise(): Promise<DB> {
  const url = connectionString();
  pool = new Pool({
    connectionString: url,
    ssl: sslOption(url),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pooled client can be dropped by the server at any time; without a handler
  // the 'error' event is unhandled and takes the whole process down.
  pool.on("error", (error) => {
    console.error("[db] idle client error", error.message);
  });

  const db = fromPool(pool);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    await client.query(SCHEMA);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY])
      .catch(() => {});
    client.release();
  }
  return db;
}

export function getDb(): Promise<DB> {
  if (!ready) {
    ready = initialise().catch((error) => {
      // A failed connection must not be cached, or every later request in this
      // process inherits the first failure even once the database is back.
      ready = null;
      throw error;
    });
  }
  return ready;
}

/** Applies the schema to an already-connected database. Used by the test harness. */
export async function applySchema(db: DB): Promise<void> {
  await db.exec(SCHEMA);
}

export async function closeDb(): Promise<void> {
  const current = pool;
  pool = null;
  ready = null;
  if (current) await current.end();
}

export function resetDbForTests(db: DB | null): void {
  ready = db ? Promise.resolve(db) : null;
}
