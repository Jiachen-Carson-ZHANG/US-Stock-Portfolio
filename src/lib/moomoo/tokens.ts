import type { DB } from "@/lib/db";
import { decrypt, encrypt, parseKey } from "@/lib/crypto";

/**
 * One connection row per portfolio, per provider.
 *
 * The row used to be a singleton keyed "moomoo", which is exactly the shape
 * that cannot hold two people's accounts. Deriving the key from the portfolio
 * keeps the upsert a one-liner and makes a second consent impossible to
 * confuse with the first.
 */
function connectionId(portfolioId: string): string {
  return `moomoo:${portfolioId}`;
}

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

export async function saveConnection(
  db: DB,
  portfolioId: string,
  params: { refreshToken: string; scope: string; accountId: string | null },
  now: Date = new Date(),
): Promise<void> {
  const payload = encrypt(params.refreshToken, encryptionKey());

  await db.run(
    `INSERT INTO broker_connections
       (id, provider, encrypted_refresh_token, iv, auth_tag, scope,
        account_id, connected_at, last_refresh_at, status, portfolio_id)
     VALUES (?, 'moomoo', ?, ?, ?, ?, ?, ?, ?, 'connected', ?)
     ON CONFLICT(id) DO UPDATE SET
       encrypted_refresh_token = excluded.encrypted_refresh_token,
       iv = excluded.iv,
       auth_tag = excluded.auth_tag,
       scope = excluded.scope,
       account_id = excluded.account_id,
       last_refresh_at = excluded.last_refresh_at,
       status = 'connected'`,
    [
      connectionId(portfolioId),
      payload.ciphertext,
      payload.iv,
      payload.authTag,
      params.scope,
      params.accountId,
      now.toISOString(),
      now.toISOString(),
      portfolioId,
    ],
  );
}

export async function readConnection(
  db: DB,
  portfolioId: string,
): Promise<BrokerConnection | null> {
  const row = await db.get<Row>(`SELECT * FROM broker_connections WHERE id = ?`, [
    connectionId(portfolioId),
  ]);

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
export async function readConnectionStatus(
  db: DB,
  portfolioId: string,
): Promise<Omit<BrokerConnection, "refreshToken"> | null> {
  const row = await db.get<Row>(
    `SELECT scope, account_id, status, connected_at, last_refresh_at
       FROM broker_connections WHERE id = ?`,
    [connectionId(portfolioId)],
  );

  if (!row) return null;

  return {
    scope: row.scope,
    accountId: row.account_id,
    status: row.status,
    connectedAt: row.connected_at,
    lastRefreshAt: row.last_refresh_at,
  };
}

export async function markStatus(
  db: DB,
  portfolioId: string,
  status: ConnectionStatus,
): Promise<void> {
  await db.run(`UPDATE broker_connections SET status = ? WHERE id = ?`, [
    status,
    connectionId(portfolioId),
  ]);
}

export async function markRefreshed(
  db: DB,
  portfolioId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.run(
    `UPDATE broker_connections SET last_refresh_at = ?, status = 'connected' WHERE id = ?`,
    [now.toISOString(), connectionId(portfolioId)],
  );
}

export async function setAccountId(
  db: DB,
  portfolioId: string,
  accountId: string,
): Promise<void> {
  await db.run(`UPDATE broker_connections SET account_id = ? WHERE id = ?`, [
    accountId,
    connectionId(portfolioId),
  ]);
}

export async function deleteConnection(db: DB, portfolioId: string): Promise<void> {
  await db.run(`DELETE FROM broker_connections WHERE id = ?`, [connectionId(portfolioId)]);
}
