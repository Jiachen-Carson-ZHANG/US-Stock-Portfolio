import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DB = Database.Database;

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
  quantity            REAL NOT NULL,
  average_cost        REAL,
  currency            TEXT NOT NULL,
  option_type         TEXT,
  strike              REAL,
  expiration_date     TEXT,
  contract_multiplier REAL,
  synced_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_cache (
  symbol         TEXT PRIMARY KEY,
  price          REAL NOT NULL,
  previous_close REAL NOT NULL,
  change         REAL NOT NULL,
  change_percent REAL NOT NULL,
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
`;

let instance: DB | null = null;

function databasePath(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/portfolio.db";
  // The path is runtime configuration, so the bundler must not try to trace it —
  // without this it pulls the entire project into the server output.
  return resolve(/*turbopackIgnore: true*/ process.cwd(), url.replace(/^file:/, ""));
}

export function getDb(): DB {
  if (instance) return instance;

  const path = databasePath();
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);

  instance = db;
  return db;
}

/** Adds columns introduced after a database was first created. */
function migrate(db: DB): void {
  const columns = db
    .prepare(`PRAGMA table_info(broker_connections)`)
    .all() as { name: string }[];

  if (!columns.some((c) => c.name === "account_id")) {
    db.exec(`ALTER TABLE broker_connections ADD COLUMN account_id TEXT`);
  }
}

/** Fresh in-memory database for tests — never touches the on-disk file. */
export function createTestDb(): DB {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function resetDbForTests(db: DB | null): void {
  instance = db;
}
