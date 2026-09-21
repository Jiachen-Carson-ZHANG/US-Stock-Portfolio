import { registerClient } from "../src/lib/moomoo/oauth";

/**
 * One-time OAuth client registration. moomoo supports dynamic registration, so
 * there is no developer portal step — this returns a client_id immediately.
 *
 * A client may hold several redirect URIs, so pass every origin the app will
 * ever be served from and one client_id covers them all:
 *
 *   npm run moomoo:register -- https://portfolio.vercel.app https://portfolio.example.com
 *
 * That matters because the URIs must be registered before the first sign-in
 * there, and moomoo compares them character for character. Registering the
 * deployment URLs up front avoids re-registering — and re-registering issues a
 * new client_id, which invalidates the stored connection.
 */
function callbackFor(base: string): string {
  const url = base.includes("://") ? base : `https://${base}`;
  return `${url.replace(/\/$/, "")}/api/broker/moomoo/callback`;
}

async function main() {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const redirectUris = [
    callbackFor(appUrl),
    // Keep the local callback registered too, so the same client works in dev
    // after APP_URL is pointed at a deployment.
    "http://localhost:3000/api/broker/moomoo/callback",
    ...process.argv.slice(2).map(callbackFor),
  ].filter((uri, i, all) => all.indexOf(uri) === i);

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
