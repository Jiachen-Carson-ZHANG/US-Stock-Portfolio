import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { recordActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { aiSchema } from "@/lib/schemas";
import { currentLocale } from "@/lib/i18n/server";
import {
  deepSeekChat,
  isDeepSeekConfigured,
  rewritePrompt,
  viewPrompt,
} from "@/lib/deepseek";
import { saveAiNote } from "@/lib/watchlist";
import { buildAiContext, GROUNDING_RULES } from "@/lib/ai/context";

/**
 * The whole portfolio, or nothing. A partial context is worse than none: the
 * model fills the gaps with invented figures that read exactly like the real
 * ones. If the snapshot cannot be built the note is refused instead.
 */
async function portfolioContext(): Promise<string | null> {
  try {
    return await buildAiContext();
  } catch (error) {
    logger.error("ai.context.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function POST(request: Request) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  if (!isDeepSeekConfigured()) {
    return Response.json(
      { error: "DEEPSEEK_API_KEY is not configured." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = aiSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const locale = await currentLocale();

  try {
    if (parsed.data.mode === "rewrite") {
      if (!parsed.data.draft) {
        return Response.json({ error: "Nothing to rewrite" }, { status: 400 });
      }
      const text = await deepSeekChat(
        rewritePrompt({ draft: parsed.data.draft, locale }),
        { maxTokens: 2500 },
      );
      return Response.json({ text });
    }

    if (!parsed.data.symbol) {
      return Response.json({ error: "Symbol required" }, { status: 400 });
    }

    const context = await portfolioContext();
    if (context === null) {
      return Response.json(
        { error: "Portfolio data is unavailable, so no grounded view can be given." },
        { status: 503 },
      );
    }

    const text = await deepSeekChat(
      viewPrompt({
        symbol: parsed.data.symbol,
        name: parsed.data.name,
        reason: parsed.data.reason ?? "",
        context,
        rules: GROUNDING_RULES,
        locale,
      }),
      { maxTokens: 6000 },
    );

    const db = await getDb();
    await saveAiNote(db, parsed.data.symbol, text);
    await recordActivity(db, {
      userId: user.id,
      username: user.username,
      kind: "ai_insight",
      target: parsed.data.symbol,
    });
    logger.info("ai.view", {
      symbol: parsed.data.symbol,
      by: user.username,
      contextChars: context.length,
    });

    return Response.json({ text });
  } catch (error) {
    logger.error("ai.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "AI request failed." }, { status: 502 });
  }
}
