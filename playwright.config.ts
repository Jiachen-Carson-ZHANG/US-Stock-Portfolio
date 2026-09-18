import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

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
    command: `rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm && npm run build && npm run db:seed && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: "file:./data/e2e.db",
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
