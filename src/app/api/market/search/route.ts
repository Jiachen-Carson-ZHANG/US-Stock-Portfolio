import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { chineseNamed, loadDirectory } from "@/lib/market/directory";
import { WELL_KNOWN, searchListings } from "@/lib/market/search";
import { symbolQuerySchema } from "@/lib/schemas";

/**
 * Symbols by ticker or by name, for the dropdown under every symbol field.
 *
 * No portfolio is involved and no broker token is spent: the answer comes
 * from the symbol directory, not a quote. The price is fetched separately,
 * once somebody has picked.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const parsed = symbolQuerySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) return Response.json({ results: [] });

  const db = await getDb();
  const [directory, chinese, priced] = await Promise.all([
    loadDirectory(db),
    chineseNamed(db, parsed.data),
    // Whatever the site has already priced is the family's own shortlist.
    db.all<{ symbol: string }>(`SELECT symbol FROM quote_cache`),
  ]);
  const preferred = new Set([...WELL_KNOWN, ...priced.map((row) => row.symbol)]);

  // Chinese names first when that is what was typed; they are the only
  // matches such a query can have.
  const results = [...chinese, ...searchListings(directory, parsed.data, 8, preferred)]
    .filter((listing, index, all) => all.findIndex((l) => l.symbol === listing.symbol) === index)
    .slice(0, 8);

  return Response.json(
    { results },
    // The directory changes once a day; the same keystrokes from the same
    // person can be answered by their own browser for a minute.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
