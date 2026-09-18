import { requireUser, isOpenAccess } from "@/lib/auth/guards";
import { baseCurrency } from "@/lib/portfolio/service";
import { getDb } from "@/lib/db";
import { readFamily } from "@/lib/family/repository";
import { FamilyRoom } from "@/components/family/family-room";
export default async function FamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const snapshots = getDb()
    .prepare(
      "SELECT snapshot_date, total_market_value, positions_json FROM portfolio_snapshots ORDER BY snapshot_date DESC LIMIT 30",
    )
    .all() as {
    snapshot_date: string;
    total_market_value: string;
    positions_json: string;
  }[];
  const latest = snapshots[0];
  const cutoff = latest
    ? new Date(Date.parse(latest.snapshot_date + "T00:00:00Z") - 7 * 86400000)
        .toISOString()
        .slice(0, 10)
    : "";
  const recent = snapshots.filter((s) => s.snapshot_date >= cutoff).reverse();
  const postcard = latest
    ? {
        date: latest.snapshot_date,
        currency: baseCurrency(),
        value: Number(latest.total_market_value),
        observations: recent.length,
        points: recent.map((s) => ({
          date: s.snapshot_date,
          value: Number(s.total_market_value),
        })),
      }
    : null;
  return (
    <FamilyRoom
      initial={readFamily(getDb(), user)}
      openAccess={isOpenAccess()}
      symbol={params.symbol?.slice(0, 32)}
      postcard={postcard}
    />
  );
}
