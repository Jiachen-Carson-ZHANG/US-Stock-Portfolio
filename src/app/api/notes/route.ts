import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { listNotes, saveNote } from "@/lib/notes";
import { stockNoteSchema, symbolSchema } from "@/lib/schemas";

/** Your own notes on one share, newest first. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const symbol = symbolSchema.safeParse(new URL(request.url).searchParams.get("symbol")?.toUpperCase());
  if (!symbol.success) return Response.json({ error: "Invalid symbol" }, { status: 400 });

  return Response.json({ notes: await listNotes(await getDb(), user.id, symbol.data) });
}

/** Writing one day's note. Only ever your own: the author is whoever is signed in. */
export async function PUT(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const parsed = stockNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid note" }, { status: 400 });

  await saveNote(await getDb(), user.id, parsed.data.symbol.toUpperCase(), parsed.data.date, parsed.data.body);
  return Response.json({ ok: true });
}
