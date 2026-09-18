import { getDb } from "../src/lib/db";
import { readConnectionStatus, readConnection } from "../src/lib/moomoo/tokens";
import { refreshAccessToken, MOOMOO_API_BASE } from "../src/lib/moomoo/oauth";
import { parseJsonPreservingBigInts } from "../src/lib/moomoo/client";

/**
 * Prints exactly what moomoo returns for each call the dashboard makes, so a
 * failed sync can be diagnosed without guessing. Never prints a token.
 */
async function probe(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${MOOMOO_API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  console.log(`\n${init.method ?? "GET"} ${path}`);
  console.log(`  HTTP ${response.status}`);
  console.log(`  ${text.slice(0, 1200)}`);
  try {
    return parseJsonPreservingBigInts(text) as {
      d?: { accounts?: { account_id?: string }[] };
    };
  } catch {
    return null;
  }
}

async function main() {
  const db = getDb();

  const status = readConnectionStatus(db);
  console.log("\n=== stored connection ===");
  console.log(status ? JSON.stringify(status, null, 2) : "none");
  if (!status) return;

  const connection = readConnection(db);
  if (!connection) return;

  console.log("\n=== refreshing access token ===");
  const tokens = await refreshAccessToken({
    refreshToken: connection.refreshToken,
    clientId: process.env.MOOMOO_CLIENT_ID as string,
  });
  console.log(`  ok, expires_in=${tokens.expires_in}s scope="${tokens.scope}"`);

  const token = tokens.access_token;

  const accounts = await probe("/api/v1.0/accounts/authorized_trd_accs", token);
  const accountId = accounts?.d?.accounts?.[0]?.account_id;
  if (!accountId) {
    console.log("\nNo account id returned — stopping here.");
    return;
  }

  await probe(`/api/v1.0/accounts/${accountId}/positions`, token);
  await probe(`/api/v1.0/accounts/${accountId}/funds?currency=USD`, token);
  await probe("/api/v1.0/quote/snapshot", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_list: ["US.AAPL"] }),
  });
}

main().catch((error) => {
  console.error("\nDoctor failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
