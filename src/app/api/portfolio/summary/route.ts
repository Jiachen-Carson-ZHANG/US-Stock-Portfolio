import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { loadPortfolio } from "@/lib/portfolio/service";

export async function GET() {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  const { summary, concentration } = await loadPortfolio();
  return Response.json({ summary, concentration });
}
