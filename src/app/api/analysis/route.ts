import { rejectCrossOrigin } from "@/lib/http/origin";
import { getDb } from "@/lib/db";
import { requirePortfolioApi, requireWritable } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import {
  analysisInputSchema,
  readAnalysis,
  saveAnalysis,
} from "@/lib/analysis/store";
export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  return Response.json(await readAnalysis(await getDb(), context.portfolio.id));
}
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  // Recording a cash flow against someone else's account is a write, and
  // being an administrator is not the same as being whose money it is.
  const denied = requireWritable(context);
  if (denied) return denied.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = analysisInputSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  try {
    return Response.json(await saveAnalysis(
        await getDb(),
        context.portfolio.id,
        parsed.data,
        context.user.id,
      ));
  } catch {
    return Response.json(
      { error: "Could not save. Check dates and values." },
      { status: 400 },
    );
  }
}
