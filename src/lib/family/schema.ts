import type { DB } from "@/lib/db";
export function ensureFamilySchema(db: DB) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS family_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);`,
  );
}
