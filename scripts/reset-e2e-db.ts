/**
 * Drops and recreates the end-to-end database so every Playwright run starts
 * from nothing. Refuses to touch a database whose name does not say it is for
 * tests — the URL is configuration, and a mistyped one must not wipe real data.
 */
import { Client } from "pg";

async function main() {
  const url =
    process.env.E2E_DATABASE_URL ??
    "postgres://fpd:devpass@127.0.0.1:55432/portfolio_e2e";
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");

  if (!/(^|[_-])(e2e|test)([_-]|$)/i.test(name)) {
    throw new Error(
      `Refusing to reset "${name}": an end-to-end database must have e2e or test in its name.`,
    );
  }

  parsed.pathname = "/postgres";
  const admin = new Client({ connectionString: parsed.toString() });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`Reset end-to-end database "${name}".`);
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
