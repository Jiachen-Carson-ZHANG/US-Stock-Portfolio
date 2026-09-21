import { toOwnPortfolio } from "@/lib/portfolios/redirect";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  await toOwnPortfolio(`/holdings/${encodeURIComponent((await params).symbol)}`);
}
