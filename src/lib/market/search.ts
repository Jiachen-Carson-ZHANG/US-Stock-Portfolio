/**
 * Finding a symbol by what people actually type.
 *
 * Somebody who wants Micron types "micron", not "MU", and somebody reading
 * in Chinese types 英伟达. The ticket used to accept only an exact ticker,
 * so anyone who did not already know it could not buy it. Pure, so the
 * ranking can be tested without the directory behind it.
 */
export type Listing = { symbol: string; name: string; etf: boolean };

const PUNCTUATION = /[.,()&-]/g;

/** Lowercase, apostrophes dropped ("McDonald's" is typed "mcdonalds"), punctuation spaced. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "").replace(PUNCTUATION, " ").replace(/\s+/g, " ").trim();
}

/**
 * Names people use that are not the listed name: Google is listed as
 * Alphabet, Facebook as Meta Platforms. Short on purpose — only the ones
 * somebody would plausibly type and get nothing for.
 */
const ALIASES: Record<string, string[]> = {
  google: ["GOOGL", "GOOG"],
  facebook: ["META"],
  instagram: ["META"],
  tsmc: ["TSM"],
  jpmorgan: ["JPM"],
  "jp morgan": ["JPM"],
  youtube: ["GOOGL", "GOOG"],
  "sp500": ["VOO", "SPY", "IVV"],
  nasdaq: ["QQQ", "ONEQ"],
};

/**
 * Symbols most people mean. When two matches are equally good, these come
 * first — so "S&P 500" offers VOO and SPY before three-letter funds nobody
 * has heard of. The route adds whatever this site has already priced, which
 * is the family's own shortlist.
 */
export const WELL_KNOWN = new Set([
  "SPY", "VOO", "IVV", "QQQ", "ONEQ", "VTI", "DIA", "IWM", "VT", "VEA", "VWO", "SCHD", "VUG",
  "VGT", "XLK", "SMH", "SOXX", "ARKK", "TLT", "GLD", "SLV", "AAPL", "MSFT", "NVDA", "GOOGL",
  "GOOG", "AMZN", "META", "TSLA", "AVGO", "BRK.B", "JPM", "V", "MA", "UNH", "XOM", "LLY", "JNJ",
  "WMT", "PG", "HD", "COST", "NFLX", "AMD", "INTC", "MU", "QCOM", "TSM", "BABA", "PDD", "NIO",
  "PLTR", "COIN", "MSTR", "SOFI", "UBER", "SHOP", "ORCL", "CRM", "ADBE", "DIS", "NKE", "KO",
  "PEP", "MCD", "SBUX", "BA", "NBIS",
]);

/**
 * Best match first: the exact ticker; a ticker starting with what was typed
 * (shorter tickers first, so "M" offers MU before MUSA); a word of the name
 * starting with it; the name containing it anywhere. Anything else is left
 * out rather than padded in.
 */
export function searchListings(
  listings: Listing[],
  query: string,
  limit = 8,
  preferred: ReadonlySet<string> = WELL_KNOWN,
): Listing[] {
  const raw = query.trim();
  if (raw.length === 0) return [];
  const upper = raw.toUpperCase();
  const lower = normalise(raw);
  const aliased = new Set(ALIASES[lower.replace(/ /g, "")] ?? ALIASES[lower] ?? []);

  const scored: { listing: Listing; score: number }[] = [];
  for (const listing of listings) {
    const name = normalise(listing.name);
    let score: number | null = null;
    if (listing.symbol === upper) score = 0;
    else if (aliased.has(listing.symbol)) score = 0.5;
    else if (listing.symbol.startsWith(upper)) score = 1;
    else if (lower.length > 0 && (` ${name}`.includes(` ${lower}`))) score = 2;
    else if (lower.length > 1 && name.includes(lower)) score = 3;
    if (score !== null) scored.push({ listing, score });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        Number(preferred.has(b.listing.symbol)) - Number(preferred.has(a.listing.symbol)) ||
        a.listing.symbol.length - b.listing.symbol.length ||
        a.listing.symbol.localeCompare(b.listing.symbol),
    )
    .slice(0, limit)
    .map((entry) => entry.listing);
}

/** "Apple Inc. - Common Stock" → "Apple Inc.", keeping what makes a warrant a warrant. */
export function cleanName(name: string): string {
  const [base, detail] = name.split(" - ");
  const trimmed = base
    .replace(/\s+(New\s+)?(Class\s+[A-Z]\s+)?(Common Stock|Ordinary Shares)$/i, "")
    .trim();
  if (detail && /warrant|unit|right|preferred|depositary|note|debenture/i.test(detail)) {
    return `${trimmed} (${detail.replace(/\s+/g, " ").trim()})`;
  }
  return trimmed;
}

/**
 * Nasdaq's two symbol-directory files: everything listed on Nasdaq, and
 * everything listed elsewhere (NYSE, NYSE American, Arca, Cboe). Test issues
 * are dropped, and so are preferred-share lines, whose tickers carry a "$"
 * nobody types.
 */
export function parseDirectory(text: string, kind: "nasdaq" | "other"): Listing[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.split("|") ?? [];
  const column = (label: string) => header.indexOf(label);
  const symbolAt = kind === "nasdaq" ? column("Symbol") : column("ACT Symbol");
  const nameAt = column("Security Name");
  const etfAt = column("ETF");
  const testAt = column("Test Issue");
  if (symbolAt < 0 || nameAt < 0) return [];

  const listings: Listing[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("|");
    const symbol = cells[symbolAt]?.trim();
    if (!symbol || line.startsWith("File Creation Time") || symbol.includes("$")) continue;
    if (testAt >= 0 && cells[testAt] === "Y") continue;
    listings.push({
      symbol,
      name: cleanName(cells[nameAt] ?? symbol),
      etf: etfAt >= 0 && cells[etfAt] === "Y",
    });
  }
  return listings;
}
