import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { symbolSchema } from "@/lib/schemas";
import { loadPosition } from "@/lib/portfolio/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  const parsed = symbolSchema.safeParse((await params).symbol);
  if (!parsed.success) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const position = await loadPosition(parsed.data);
  if (!position) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ position });
}
