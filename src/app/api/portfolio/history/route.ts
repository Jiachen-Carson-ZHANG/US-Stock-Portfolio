import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { historyRangeSchema } from "@/lib/schemas";
import { loadHistory } from "@/lib/portfolio/service";

export async function GET(request: Request) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const parsed = historyRangeSchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid range" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - parsed.data.days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const snapshots = loadHistory().filter((s) => s.snapshotDate >= cutoff);
  return Response.json({ snapshots });
}
