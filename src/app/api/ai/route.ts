import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
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
import { loadPortfolio } from "@/lib/portfolio/service";
import { formatMoney } from "@/lib/money";

/** A short factual summary so the model reasons about the real portfolio. */
async function portfolioContext(): Promise<string> {
  try {
    const { summary, positions } = await loadPortfolio();
    const top = positions
      .filter((p) => p.instrumentType !== "cash")
      .slice(0, 6)
      .map((p) => p.symbol)
      .join(", ");

    return [
      `Portfolio value ${formatMoney(summary.totalMarketValue)}`,
      `cash ${formatMoney(summary.cashValue)}`,
      top ? `largest holdings: ${top}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  } catch {
    return "";
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

    const text = await deepSeekChat(
      viewPrompt({
        symbol: parsed.data.symbol,
        name: parsed.data.name,
        reason: parsed.data.reason ?? "",
        context: await portfolioContext(),
        locale,
      }),
    );

    saveAiNote(await getDb(), parsed.data.symbol, text);
    logger.info("ai.view", { symbol: parsed.data.symbol, by: user.username });

    return Response.json({ text });
  } catch (error) {
    logger.error("ai.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "AI request failed." }, { status: 502 });
  }
}
