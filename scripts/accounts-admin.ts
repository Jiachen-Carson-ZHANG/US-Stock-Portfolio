/**
 * Renaming people and removing accounts, against whichever database
 * DATABASE_URL points at.
 *
 *   npx tsx scripts/accounts-admin.ts                       # show, change nothing
 *   npx tsx scripts/accounts-admin.ts --rename <user> <name>
 *   npx tsx scripts/accounts-admin.ts --delete <username>   # add --confirm to act
 *
 * Listing is the default and deleting needs --confirm, because removing an
 * account takes its portfolios, orders and trade history with it through the
 * foreign keys, and that cannot be undone from here.
 */
import { closeDb, getDb } from "../src/lib/db";

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
};

type PortfolioRow = {
  id: string;
  slug: string;
  display_name: string;
  kind: string;
  owner_user_id: string | null;
};

async function main() {
  const args = process.argv.slice(2);
  const db = await getDb();

  const users = await db.all<UserRow>(
    `SELECT id, username, display_name, role, status, created_at
       FROM users ORDER BY created_at`,
  );
  const portfolios = await db.all<PortfolioRow>(
    `SELECT id, slug, display_name, kind, owner_user_id FROM portfolios ORDER BY slug`,
  );

  const renameAt = args.indexOf("--rename");
  const deleteAt = args.indexOf("--delete");
  const confirmed = args.includes("--confirm");

  if (renameAt !== -1) {
    const username = args[renameAt + 1]?.toLowerCase();
    const name = args[renameAt + 2];
    if (!username || !name) throw new Error("Usage: --rename <username> <display name>");

    const user = users.find((u) => u.username === username);
    if (!user) throw new Error(`No account called ${username}`);

    await db.run(`UPDATE users SET display_name = ? WHERE id = ?`, [name, user.id]);
    // Their own portfolios carry their name too; leaving those saying "Owner"
    // while the sidebar says the real one is worse than not renaming at all.
    const renamed = await db.run(
      `UPDATE portfolios SET display_name = ? WHERE owner_user_id = ? AND kind = 'broker'`,
      [name, user.id],
    );
    const mockRenamed = await db.run(
      `UPDATE portfolios SET display_name = ? WHERE owner_user_id = ? AND kind = 'mock'`,
      [`${name} · mock`, user.id],
    );
    console.log(
      `Renamed ${username} to ${name} (${renamed.changes} real, ${mockRenamed.changes} mock portfolios).`,
    );
  }

  if (deleteAt !== -1) {
    const targets = args
      .slice(deleteAt + 1)
      .filter((value) => !value.startsWith("--"))
      .map((value) => value.toLowerCase());
    if (targets.length === 0) throw new Error("Usage: --delete <username> [username…]");

    for (const username of targets) {
      const user = users.find((u) => u.username === username);
      if (!user) {
        console.log(`No account called ${username}; nothing to remove.`);
        continue;
      }
      const theirs = portfolios.filter((p) => p.owner_user_id === user.id);

      console.log(
        `${confirmed ? "Removing" : "Would remove"} ${username} (${user.display_name}) ` +
          `and ${theirs.length} portfolio(s): ${theirs.map((p) => p.slug).join(", ") || "none"}`,
      );

      if (confirmed) {
        await db.run(`DELETE FROM users WHERE id = ?`, [user.id]);
      }
    }

    if (!confirmed) console.log("\nNothing was changed. Add --confirm to go ahead.");
  }

  if (renameAt === -1 && deleteAt === -1) {
    console.log("ACCOUNTS");
    for (const user of users) {
      console.log(
        `  ${user.username.padEnd(16)} ${user.display_name.padEnd(20)} ` +
          `${user.role.padEnd(7)} ${user.status}`,
      );
    }
    console.log("\nPORTFOLIOS");
    for (const portfolio of portfolios) {
      const owner = users.find((u) => u.id === portfolio.owner_user_id);
      console.log(
        `  ${portfolio.slug.padEnd(20)} ${portfolio.display_name.padEnd(22)} ` +
          `${portfolio.kind.padEnd(7)} owner=${owner?.username ?? "—"}`,
      );
    }
  }

  await closeDb();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
