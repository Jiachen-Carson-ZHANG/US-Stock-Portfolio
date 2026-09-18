import type { DB } from "@/lib/db";
import { decrypt, encrypt, parseKey } from "@/lib/crypto";

const CONNECTION_ID = "moomoo";

export type ConnectionStatus = "connected" | "expired" | "error";

export type BrokerConnection = {
  refreshToken: string;
  scope: string;
  accountId: string | null;
  status: ConnectionStatus;
  connectedAt: string;
  lastRefreshAt: string | null;
};

type Row = {
  encrypted_refresh_token: string;
  iv: string;
  auth_tag: string;
  scope: string;
  account_id: string | null;
  status: ConnectionStatus;
  connected_at: string;
  last_refresh_at: string | null;
};

function encryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set — cannot store broker tokens.");
  }
  return parseKey(raw);
}

export function saveConnection(
  db: DB,
  params: { refreshToken: string; scope: string; accountId: string | null },
  now: Date = new Date(),
): void {
  const payload = encrypt(params.refreshToken, encryptionKey());

  db.prepare(
    `INSERT INTO broker_connections
       (id, provider, encrypted_refresh_token, iv, auth_tag, scope,
        account_id, connected_at, last_refresh_at, status)
     VALUES (?, 'moomoo', ?, ?, ?, ?, ?, ?, ?, 'connected')
     ON CONFLICT(id) DO UPDATE SET
       encrypted_refresh_token = excluded.encrypted_refresh_token,
       iv = excluded.iv,
       auth_tag = excluded.auth_tag,
       scope = excluded.scope,
       account_id = excluded.account_id,
       last_refresh_at = excluded.last_refresh_at,
       status = 'connected'`,
  ).run(
    CONNECTION_ID,
    payload.ciphertext,
    payload.iv,
    payload.authTag,
    params.scope,
    params.accountId,
    now.toISOString(),
    now.toISOString(),
  );
}

export function readConnection(db: DB): BrokerConnection | null {
  const row = db
    .prepare(`SELECT * FROM broker_connections WHERE id = ?`)
    .get(CONNECTION_ID) as Row | undefined;

  if (!row) return null;

  return {
    refreshToken: decrypt(
      {
        ciphertext: row.encrypted_refresh_token,
        iv: row.iv,
        authTag: row.auth_tag,
      },
      encryptionKey(),
    ),
    scope: row.scope,
    accountId: row.account_id,
    status: row.status,
    connectedAt: row.connected_at,
    lastRefreshAt: row.last_refresh_at,
  };
}

/** Connection metadata for the owner's settings screen — never the token. */
export function readConnectionStatus(db: DB): Omit<
  BrokerConnection,
  "refreshToken"
> | null {
  const row = db
    .prepare(
      `SELECT scope, account_id, status, connected_at, last_refresh_at
       FROM broker_connections WHERE id = ?`,
    )
    .get(CONNECTION_ID) as Row | undefined;

  if (!row) return null;

  return {
    scope: row.scope,
    accountId: row.account_id,
    status: row.status,
    connectedAt: row.connected_at,
    lastRefreshAt: row.last_refresh_at,
  };
}

export function markStatus(db: DB, status: ConnectionStatus): void {
  db.prepare(`UPDATE broker_connections SET status = ? WHERE id = ?`).run(
    status,
    CONNECTION_ID,
  );
}

export function markRefreshed(db: DB, now: Date = new Date()): void {
  db.prepare(
    `UPDATE broker_connections SET last_refresh_at = ?, status = 'connected' WHERE id = ?`,
  ).run(now.toISOString(), CONNECTION_ID);
}

export function setAccountId(db: DB, accountId: string): void {
  db.prepare(`UPDATE broker_connections SET account_id = ? WHERE id = ?`).run(
    accountId,
    CONNECTION_ID,
  );
}

export function deleteConnection(db: DB): void {
  db.prepare(`DELETE FROM broker_connections WHERE id = ?`).run(CONNECTION_ID);
}
