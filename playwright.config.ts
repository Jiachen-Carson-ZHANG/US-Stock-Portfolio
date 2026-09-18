import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

// A database of its own, so a run never touches development data. Point
// E2E_DATABASE_URL at any Postgres; `npm run db:dev:up` starts a local one.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://fpd:devpass@127.0.0.1:55432/portfolio_e2e";

export default defineConfig({
  testDir: "./src/tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // The schema is dropped and recreated so each run starts clean, and the
    // standalone server is started directly: `next start` does not work with
    // output: standalone, which is what the app builds.
    command: [
      `npm run db:e2e:reset`,
      `npm run build`,
      `npm run db:seed`,
      `cp -r .next/static .next/standalone/.next/static`,
      `if [ -d public ]; then cp -r public .next/standalone/public; fi`,
      `node .next/standalone/server.js`,
    ].join(" && "),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL,
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATA_PROVIDER: "mock",
      // The suite covers sign-in and role enforcement, so it runs the guarded
      // path even though local development defaults to open access.
      AUTH_MODE: "password",
      SNAPSHOT_CRON_SECRET: "e2e-snapshot-secret",
      SEED_OWNER_PASSWORD: "e2e-owner-pass",
      SEED_FATHER_PASSWORD: "e2e-father-pass",
      SEED_MOTHER_PASSWORD: "e2e-mother-pass",
      SEED_WIFE_PASSWORD: "e2e-wife-pass",
    },
  },
});
