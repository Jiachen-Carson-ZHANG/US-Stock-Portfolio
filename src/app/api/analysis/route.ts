import { rejectCrossOrigin } from "@/lib/http/origin";
import {
  authenticateRequest,
  requireApiOwner,
  unauthorized,
} from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import {
  analysisInputSchema,
  readAnalysis,
  saveAnalysis,
} from "@/lib/analysis/store";
export async function GET() {
  if (!(await authenticateRequest())) return unauthorized();
  return Response.json(await readAnalysis(await getDb()));
}
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;
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
    return Response.json(await saveAnalysis(await getDb(), parsed.data, auth.user.id));
  } catch {
    return Response.json(
      { error: "Could not save. Check dates and values." },
      { status: 400 },
    );
  }
}
