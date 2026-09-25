import { RememberViewing } from "@/components/layout/remember-viewing";
import { rememberedSlug } from "@/lib/portfolios/last-viewed";

/**
 * Everything under a portfolio's address.
 *
 * Its one job is noticing which portfolio that is, so the pages without one
 * in their address — the playground, the watchlist, the site root — keep
 * the reader on it instead of dropping them back into their own account.
 * Only reported when it differs from what is already remembered, so an
 * ordinary page load costs nothing extra.
 */
export default async function PortfolioLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ portfolio: string }>;
}) {
  const [{ portfolio }, remembered] = await Promise.all([params, rememberedSlug()]);

  return (
    <>
      {remembered !== portfolio && <RememberViewing slug={portfolio} />}
      {children}
    </>
  );
}
