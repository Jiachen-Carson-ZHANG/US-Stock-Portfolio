import { recordActivity } from "@/lib/activity";
import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  createPortfolio,
  findBySlug,
  grantAccess,
  listPortfolios,
  readersOf,
  revokeAccess,
} from "@/lib/portfolios";
import { createPortfolioSchema, portfolioAccessSchema } from "@/lib/schemas";

/**
 * Creating portfolios and deciding who may read them is an administrative
 * act, so it stays with the owner role. Everything a portfolio then does —
 * connecting a broker, recording a deposit — belongs to the person who owns
 * it, not to whoever created it.
 */
export async function GET() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const db = await getDb();
  const portfolios = await listPortfolios(db);
  return Response.json({
    portfolios: await Promise.all(
      portfolios.map(async (portfolio) => ({
        ...portfolio,
        readers: await readersOf(db, portfolio.id),
      })),
    ),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = createPortfolioSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid portfolio" },
      { status: 400 },
    );
  }

  const db = await getDb();
  if (await findBySlug(db, parsed.data.slug)) {
    return Response.json(
      { error: `/${parsed.data.slug} is already taken.` },
      { status: 409 },
    );
  }

  const owner = await db.get<{ id: string }>(
    `SELECT id FROM users WHERE id = ? AND disabled_at IS NULL`,
    [parsed.data.ownerUserId],
  );
  if (!owner) return Response.json({ error: "No such person" }, { status: 400 });

  try {
    const portfolio = await createPortfolio(db, {
      slug: parsed.data.slug,
      displayName: parsed.data.displayName,
      ownerUserId: parsed.data.ownerUserId,
      kind: parsed.data.kind,
      openingCash: parsed.data.kind === "mock" ? parsed.data.openingCash : null,
    });

    logger.info("portfolio.created", { slug: portfolio.slug, kind: portfolio.kind });
    await recordActivity(db, {
      userId: auth.user.id,
      username: auth.user.username,
      kind: "portfolio_create",
      target: portfolio.slug,
      detail: portfolio.kind,
    });

    return Response.json({ portfolio }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not create" },
      { status: 400 },
    );
  }
}

/** Grants or removes one person's access to one portfolio. */
export async function PATCH(request: Request) {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = portfolioAccessSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const { portfolioId, userId, grant } = parsed.data;

  if (grant) await grantAccess(db, portfolioId, userId);
  else await revokeAccess(db, portfolioId, userId);

  await recordActivity(db, {
    userId: auth.user.id,
    username: auth.user.username,
    kind: grant ? "access_grant" : "access_revoke",
    target: portfolioId,
  });

  return Response.json({ ok: true });
}
