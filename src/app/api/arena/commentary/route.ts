import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { isDeepSeekConfigured } from "@/lib/deepseek";
import { currentLocale } from "@/lib/i18n/server";
import { ARENA_RULES, buildArenaContext } from "@/lib/arena/context";
import { writeCommentary } from "@/lib/arena/commentary";
import { PERIODS, type Period } from "@/lib/arena";

// The hosting plan caps this at 60 seconds whatever is asked for.
export const maxDuration = 60;

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  if (!isDeepSeekConfigured()) {
    return Response.json({ error: "DEEPSEEK_API_KEY is not configured." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const period: Period = PERIODS.includes(body?.period) ? body.period : "week";

  try {
    // Built from what this viewer may see, so the commentary can never
    // describe a portfolio they are not allowed to open.
    const { text: context, symbols } = await buildArenaContext(
      await getDb(),
      user,
      period,
    );

    const commentary = await writeCommentary({
      period,
      context,
      symbols,
      rules: ARENA_RULES,
      locale: await currentLocale(),
    });

    logger.info("arena.commentary", {
      period,
      by: user.username,
      sources: commentary.sources.length,
    });

    return Response.json(commentary);
  } catch (error) {
    logger.error("arena.commentary.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Could not write the report." }, { status: 502 });
  }
}
