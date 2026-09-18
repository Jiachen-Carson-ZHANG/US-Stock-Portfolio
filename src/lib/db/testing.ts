import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { applySchema, type DB } from "./index";
import { toPositionalParams } from "./sql";

/**
 * SQLite gave every test file a private `:memory:` database. Postgres has no
 * such thing, so isolation comes from a throwaway schema per test database:
 * the pool pins `search_path` to it, so identical table names in concurrent
 * suites never collide.
 */
export type TestDb = DB & { close: () => Promise<void> };

export function testConnectionString(): string | undefined {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
}

export async function createTestDb(): Promise<TestDb> {
  const connectionString = testConnectionString();
  if (!connectionString) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Database tests need a real Postgres — " +
        "see README.md (npm run db:dev:up starts one).",
    );
  }

  const schema = `test_${randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
    max: 4,
  });
  pool.on("error", () => {});

  const runner = {
    async get<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(toPositionalParams(sql), params);
      return result.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(toPositionalParams(sql), params);
      return result.rows as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const result = await pool.query(toPositionalParams(sql), params);
      return { changes: result.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const scoped: DB = {
        async get<U>(sql: string, params: unknown[] = []) {
          const r = await client.query(toPositionalParams(sql), params);
          return r.rows[0] as U | undefined;
        },
        async all<U>(sql: string, params: unknown[] = []) {
          const r = await client.query(toPositionalParams(sql), params);
          return r.rows as U[];
        },
        async run(sql: string, params: unknown[] = []) {
          const r = await client.query(toPositionalParams(sql), params);
          return { changes: r.rowCount ?? 0 };
        },
        async exec(sql: string) {
          await client.query(sql);
        },
        async transaction<U>(inner: (tx: DB) => Promise<U>) {
          return inner(scoped);
        },
      };
      try {
        await client.query("BEGIN");
        const result = await fn(scoped);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  } satisfies DB;

  await applySchema(runner);

  return {
    ...runner,
    async close() {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
      await pool.end();
    },
  };
}
