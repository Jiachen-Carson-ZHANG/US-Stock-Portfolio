import { registerClient } from "../src/lib/moomoo/oauth";

/**
 * One-time OAuth client registration. moomoo supports dynamic registration, so
 * there is no developer portal step — this returns a client_id immediately.
 */
async function main() {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const callback = `${appUrl}/api/broker/moomoo/callback`;

  const redirectUris = [callback];
  // Keep the local callback registered too, so the same client works in dev
  // after APP_URL is pointed at a deployment.
  const local = "http://localhost:3000/api/broker/moomoo/callback";
  if (!redirectUris.includes(local)) redirectUris.push(local);

  console.log("\nRegistering a moomoo OAuth client");
  console.log("  redirect URIs:");
  for (const uri of redirectUris) console.log(`    ${uri}`);

  const client = await registerClient({
    redirectUris,
    clientName: "Family Portfolio Dashboard",
  });

  console.log("\nRegistered.\n");
  console.log(`  MOOMOO_CLIENT_ID=${client.client_id}\n`);
  console.log("Add that line to .env.local, restart the dev server, then open");
  console.log("Settings and click Connect moomoo.\n");
  console.log(`Scopes this client may request: ${client.scope}`);
  console.log("On moomoo's consent screen grant ONLY trade:read and quote:read —");
  console.log("a write scope is refused and the connection will not be saved.\n");
}

main().catch((error) => {
  console.error("\nRegistration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
