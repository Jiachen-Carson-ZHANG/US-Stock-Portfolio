import { toOwnPortfolio } from "@/lib/portfolios/redirect";

export const dynamic = "force-dynamic";

export default async function Page() {
  await toOwnPortfolio("/holdings");
}
