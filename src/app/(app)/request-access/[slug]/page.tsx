import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { canRead, findBySlug } from "@/lib/portfolios";
import { redirect } from "next/navigation";
import { RequestAccess } from "@/components/layout/request-access";

export const dynamic = "force-dynamic";

export default async function RequestAccessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requireUser();
  const { slug } = await params;

  const db = await getDb();
  const portfolio = await findBySlug(db, slug);
  if (!portfolio) notFound();

  // Someone who already has access should never see this page, and the most
  // likely way to arrive is a stale link after being approved.
  if (await canRead(db, user, portfolio.id)) redirect(`/${portfolio.slug}`);

  const pending = await db.get<{ id: string }>(
    `SELECT id FROM access_requests
      WHERE portfolio_id = ? AND user_id = ? AND status = 'pending'`,
    [portfolio.id, user.id],
  );

  const owner = portfolio.ownerUserId
    ? await db.get<{ display_name: string }>(
        `SELECT display_name FROM users WHERE id = ?`,
        [portfolio.ownerUserId],
      )
    : null;

  return (
    <RequestAccess
      slug={portfolio.slug}
      name={portfolio.displayName}
      ownerName={owner?.display_name ?? null}
      alreadyAsked={pending !== undefined}
    />
  );
}
