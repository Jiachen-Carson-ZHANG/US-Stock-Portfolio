import { recordActivity } from "@/lib/activity";
import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { addPost, PostError, readRoom, removePost, type Horizon } from "@/lib/playground";
import { playgroundPostSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return Response.json({ threads: await readRoom(await getDb()) });
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = playgroundPostSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid post" },
      { status: 400 },
    );
  }

  const db = await getDb();
  try {
    const post = await addPost(db, {
      userId: user.id,
      author: user.displayName,
      body: parsed.data.body,
      symbol: parsed.data.symbol || null,
      horizon: (parsed.data.horizon || null) as Horizon | null,
      parentId: parsed.data.parentId || null,
    });

    await recordActivity(db, {
      userId: user.id,
      username: user.username,
      kind: parsed.data.parentId ? "playground_reply" : "playground_post",
      target: post.symbol ?? "playground",
    });

    return Response.json({ post });
  } catch (error) {
    if (error instanceof PostError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Could not post that." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return Response.json({ error: "Invalid request" }, { status: 400 });

  const removed = await removePost(await getDb(), {
    id,
    userId: user.id,
    isAdministrator: user.role === "owner",
  });
  if (!removed) {
    return Response.json({ error: "That is not yours to remove." }, { status: 403 });
  }
  return Response.json({ ok: true });
}
