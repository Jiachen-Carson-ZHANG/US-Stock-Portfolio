const ENDPOINT = "https://api.tavily.com/search";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export function isSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/**
 * A handful of recent articles about a ticker or a theme.
 *
 * Optional throughout: without a key the commentary still runs, it just
 * cannot say why the market moved. That is the right failure — a missing
 * search key should cost a paragraph, not the whole feature.
 *
 * Results are quoted to the model as somebody else's claims, never as facts
 * the app vouches for.
 */
export async function search(
  query: string,
  options: { maxResults?: number; days?: number } = {},
): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        topic: "news",
        days: options.days ?? 3,
        max_results: options.maxResults ?? 4,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return [];

    const body = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };

    return (body.results ?? [])
      .filter((result) => result.title && result.url)
      .map((result) => ({
        title: result.title as string,
        url: result.url as string,
        snippet: (result.content ?? "").slice(0, 400),
      }));
  } catch {
    // Never let a search outage take the commentary down with it.
    return [];
  }
}
