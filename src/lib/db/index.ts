import { Pool, type PoolClient } from "pg";
import { ensureDefaultPortfolio } from "@/lib/portfolios";
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
  created_at            TEXT NOT NULL,
  -- Without these a day's row records only what was being carried, so a chart
  -- drawn from history could never show the whole result. Every day recorded
  -- before they existed is a day that cannot be re-derived.
  realized_pnl          TEXT,
  net_deposits          TEXT,
  -- How the row was produced: a live capture, or reconstructed from fills.
  source                TEXT NOT NULL DEFAULT 'live'
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

-- One row per portfolio. Everything that used to mean "the portfolio" is now
-- scoped by this, so a second person's account is a row rather than a fork.
CREATE TABLE IF NOT EXISTS portfolios (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  -- Nullable so removing a person does not delete the portfolio with them;
  -- an orphan is visible to owners and can be reassigned.
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('broker','mock')),
  base_currency TEXT NOT NULL DEFAULT 'USD',
  -- Mock portfolios start from a stated balance. Broker ones take their
  -- opening position from the cash-flow ledger instead.
  opening_cash  TEXT,
  created_at    TEXT NOT NULL
);

-- Who, besides the owner, may read a portfolio. Absence of a row is denial.
CREATE TABLE IF NOT EXISTS portfolio_access (
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_at   TEXT NOT NULL,
  PRIMARY KEY (portfolio_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_access_user ON portfolio_access(user_id);

-- Asking for access, and being told about it.
CREATE TABLE IF NOT EXISTS access_requests (
  id           TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending','approved','declined')),
  created_at   TEXT NOT NULL,
  decided_at   TEXT,
  decided_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);
-- One live request per person per portfolio: asking twice is the same ask,
-- and a queue of duplicates is noise for whoever has to answer it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_request_pending
  ON access_requests(portfolio_id, user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, read_at, created_at DESC);

-- Columns introduced after the first release. Postgres supports IF NOT EXISTS
-- here, so the SQLite era's PRAGMA-driven migration helper is no longer needed.
ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS account_id TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_price DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_market_value DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_unrealized_pnl DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_today_pnl DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reported_realized_pnl DOUBLE PRECISION;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS realized_pnl TEXT;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS net_deposits TEXT;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'live';

-- Multi-portfolio scoping. Nullable at the column level and backfilled on
-- boot: an existing deployment has rows that predate portfolios, and failing
-- to start is a worse outcome than a row briefly carrying no owner.
ALTER TABLE positions           ADD COLUMN IF NOT EXISTS portfolio_id TEXT REFERENCES portfolios(id) ON DELETE CASCADE;
ALTER TABLE transactions        ADD COLUMN IF NOT EXISTS portfolio_id TEXT REFERENCES portfolios(id) ON DELETE CASCADE;
ALTER TABLE broker_connections  ADD COLUMN IF NOT EXISTS portfolio_id TEXT REFERENCES portfolios(id) ON DELETE CASCADE;
ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS portfolio_id TEXT REFERENCES portfolios(id) ON DELETE CASCADE;
ALTER TABLE analysis_flows      ADD COLUMN IF NOT EXISTS portfolio_id TEXT REFERENCES portfolios(id) ON DELETE CASCADE;
ALTER TABLE analysis_config     ADD COLUMN IF NOT EXISTS portfolio_id TEXT REFERENCES portfolios(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_positions_portfolio    ON positions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio ON transactions(portfolio_id, traded_at DESC);
CREATE INDEX IF NOT EXISTS idx_flows_portfolio        ON analysis_flows(portfolio_id, date);

-- A snapshot date was unique across the whole table, which with two portfolios
-- would let one overwrite the other's day. The uniqueness belongs to the pair.
ALTER TABLE portfolio_snapshots DROP CONSTRAINT IF EXISTS portfolio_snapshots_snapshot_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_portfolio_date
  ON portfolio_snapshots(portfolio_id, snapshot_date);

-- Same reasoning for the analysis settings: "deposits reviewed to here" is a
-- statement about one portfolio, not about the database.
ALTER TABLE analysis_config DROP CONSTRAINT IF EXISTS analysis_config_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_config_scope
  ON analysis_config(portfolio_id, key);

-- One broker connection per portfolio, so a second consent cannot silently
-- attach a second token to the same account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connection_portfolio
  ON broker_connections(portfolio_id, provider);

-- "Paper" was the accounting term; "mock" is what the family calls it, and
-- what the address says. Renamed before anyone had one, so this only has to
-- run for a database created in the hours between.
ALTER TABLE portfolios DROP CONSTRAINT IF EXISTS portfolios_kind_check;
UPDATE portfolios SET kind = 'mock' WHERE kind = 'paper';
ALTER TABLE portfolios ADD CONSTRAINT portfolios_kind_check CHECK (kind IN ('broker','mock'));
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
    // Wrapped in an explicit transaction, with a transaction-scoped lock, so it
    // survives a connection pooler. Under PgBouncer's transaction mode — which
    // is what a managed "pooled" connection string gives you — consecutive
    // statements outside a transaction can land on different backends, so a
    // session-level lock would guard nothing and its release would apply to
    // some other connection. The lock ends with the COMMIT either way.
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK_KEY]);
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Adopts rows written before portfolios existed. Idempotent, and run here
  // rather than in a migration script because a row no portfolio can see is
  // invisible in the app but still counted by every total.
  await ensureDefaultPortfolio(db);

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
