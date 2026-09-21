import "server-only";
import { redirect } from "next/navigation";
import { requirePortfolio } from "./context";

/**
 * Sends an old, unscoped path to the same page under the viewer's own
 * portfolio.
 *
 * Bookmarks and anything already sent to the family point at /dashboard and
 * /holdings. Those paths keep working rather than breaking on the day the
 * addresses changed.
 */
export async function toOwnPortfolio(suffix = ""): Promise<never> {
  const { portfolio } = await requirePortfolio();
  redirect(`/${portfolio.slug}${suffix}`);
}
