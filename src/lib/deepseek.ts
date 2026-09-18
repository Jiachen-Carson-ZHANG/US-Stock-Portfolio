const DEFAULT_BASE_URL = "https://api.deepseek.com";
// Current id for DeepSeek-V4.1-Flash. The older deepseek-chat / deepseek-reasoner
// names are legacy and scheduled for discontinuation.
const DEFAULT_MODEL = "deepseek-flash";

/**
 * Any OpenAI-compatible endpoint works, so the provider and model are
 * configuration rather than code — DeepSeek, Zhipu GLM and Moonshot all expose
 * the same /chat/completions shape.
 */
export function aiBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

export function aiModel(): string {
  return process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;
}

export class DeepSeekNotConfiguredError extends Error {
  constructor() {
    super("DEEPSEEK_API_KEY is not set.");
    this.name = "DeepSeekNotConfiguredError";
  }
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export type ChatMessage = { role: "system" | "user"; content: string };

/**
 * The key stays server-side; the browser only ever sees the completed text.
 */
export async function deepSeekChat(
  messages: ChatMessage[],
  options: { maxTokens?: number } = {},
): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new DeepSeekNotConfiguredError();

  const response = await fetch(`${aiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: aiModel(),
      messages,
      max_tokens: options.maxTokens ?? 700,
      temperature: 0.4,
      stream: false,
    }),
  });

  if (!response.ok) {
    // The body names the cause (unknown model, bad key, no quota); the key is
    // never part of it.
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`AI provider returned HTTP ${response.status}: ${detail}`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("DeepSeek returned no content.");
  return text;
}

const LANGUAGE = {
  en: "Reply in English.",
  zh: "Reply in Simplified Chinese (简体中文).",
};

/**
 * Grounds the model in the family's actual numbers. Without the holdings in
 * context it invents prices, which is the fastest way to lose their trust.
 */
export function viewPrompt(params: {
  symbol: string;
  name?: string | null;
  reason: string;
  context: string;
  locale: "en" | "zh";
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are helping a family think about their own investment watchlist.",
        "Give a direct, concrete opinion — including whether the idea looks attractive or not, and why.",
        "Be specific about what would have to be true for it to work, and what would break it.",
        "Never invent prices, figures or dates. If you do not know something, say so.",
        "Keep it under 200 words. No disclaimers; the interface adds its own.",
        LANGUAGE[params.locale],
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Ticker: ${params.symbol}${params.name ? ` (${params.name})` : ""}`,
        `Why a family member is watching it: ${params.reason}`,
        params.context ? `Portfolio context: ${params.context}` : "",
        "Give your view.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export function rewritePrompt(params: {
  draft: string;
  locale: "en" | "zh";
}): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Rewrite the note so it reads clearly and keeps the author's meaning and opinion.",
        "Do not add new claims, figures or recommendations that are not already there.",
        "Return only the rewritten note, under 120 words.",
        LANGUAGE[params.locale],
      ].join(" "),
    },
    { role: "user", content: params.draft },
  ];
}
