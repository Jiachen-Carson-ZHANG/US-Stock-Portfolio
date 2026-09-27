import "server-only";
import type { DB } from "@/lib/db";
import { runLater } from "@/lib/later";
import { dedupe } from "@/lib/inflight";
import { logger } from "@/lib/logger";
import { cachedSeries } from "@/lib/analysis/series-cache";
import { loadDirectory } from "./directory";

/**
 * Which industry each holding is in.
 *
 * moomoo's positions carry no sector, so the overview's sector bar had
 * nothing to draw. The classification comes from the SEC instead: every US
 * listed company files under a Standard Industrial Classification code, and
 * the SEC publishes it for free. The code is far too fine to show as it is
 * ("Services, Computer Programming, Data Processing, Etc."), so it is folded
 * into a dozen plain sectors here. Exchange traded funds file no such code
 * and are counted as funds, from the exchanges' own listing.
 */
export const SECTORS = [
  "technology",
  "communication",
  "consumer",
  "healthcare",
  "financials",
  "realEstate",
  "industrials",
  "materials",
  "energy",
  "utilities",
  "funds",
  "other",
] as const;
export type Sector = (typeof SECTORS)[number];

/** A four-digit SIC code, folded into one of the sectors above. */
export function sectorFromSic(sic: number): Sector {
  if (!Number.isFinite(sic) || sic <= 0) return "other";
  const major = Math.floor(sic / 100);
  // Specific ranges before the broad ones they sit inside.
  if (sic >= 3570 && sic <= 3579) return "technology"; // computers
  if (sic >= 3600 && sic <= 3699) return "technology"; // electronics, semiconductors
  if (sic >= 3810 && sic <= 3829) return "technology"; // measuring instruments
  if (sic >= 3840 && sic <= 3851) return "healthcare"; // medical instruments
  if (sic >= 7370 && sic <= 7379) return "technology"; // software and services
  if (sic >= 2830 && sic <= 2836) return "healthcare"; // medicines
  if (sic >= 2840 && sic <= 2844) return "consumer"; // soap, cosmetics
  if (sic >= 8000 && sic <= 8099) return "healthcare"; // health services
  if (sic === 6798 || major === 65) return "realEstate";
  if (major >= 60 && major <= 67) return "financials";
  if (major === 48) return "communication";
  if (major === 49) return "utilities";
  if (major === 12 || major === 13 || major === 29) return "energy";
  if (major === 10 || major === 14) return "materials";
  if ([24, 26, 28, 30, 32, 33].includes(major)) return "materials";
  if (major === 27 || major === 78 || major === 79) return "communication";
  if (major === 37 && sic < 3720) return "consumer"; // cars
  if ([20, 21, 22, 23, 25, 31, 39].includes(major)) return "consumer";
  if (major >= 52 && major <= 59) return "consumer"; // shops and restaurants
  if (major >= 1 && major <= 9) return "consumer"; // farming and food
  if ([34, 35, 36, 37, 38].includes(major)) return "industrials";
  if (major >= 15 && major <= 17) return "industrials"; // construction
  if (major >= 40 && major <= 47) return "industrials"; // transport
  if (major >= 50 && major <= 51) return "industrials"; // wholesale
  if (major >= 70 && major <= 89) return "industrials"; // other services
  return "other";
}

/** Sent with every request to the SEC, which asks callers to say who they are. */
const USER_AGENT = "FamilyPortfolioDashboard/1.0 (+https://carson-us-portfolio.vercel.app)";

/** How many unknown symbols one background pass looks up, to stay polite. */
const PER_PASS = 20;

const key = (symbol: string) => `sector:${symbol}`;

/**
 * The sectors already known for these symbols, straight from the cache.
 *
 * Never waits on the SEC: anything not yet classified is looked up after the
 * page has been answered, and shows from the next load.
 */
export async function sectorsFor(db: DB, symbols: string[]): Promise<Map<string, Sector>> {
  const wanted = [...new Set(symbols.filter((symbol) => symbol && !symbol.endsWith(".CASH")))];
  if (wanted.length === 0) return new Map();

  const rows = await db.all<{ key: string; payload: string }>(
    `SELECT key, payload FROM series_cache WHERE key IN (${wanted.map(() => "?").join(", ")})`,
    wanted.map(key),
  );
  const known = new Map<string, Sector>();
  for (const row of rows) {
    try {
      const sector = JSON.parse(row.payload) as Sector;
      if (SECTORS.includes(sector)) known.set(row.key.slice("sector:".length), sector);
    } catch {
      // Unreadable: looked up again below.
    }
  }

  const missing = wanted.filter((symbol) => !known.has(symbol));
  if (missing.length > 0) {
    runLater(() =>
      dedupe(`sectors:${missing.slice(0, PER_PASS).sort().join(",")}`, () =>
        classify(db, missing.slice(0, PER_PASS)),
      ),
    );
  }
  return known;
}

async function classify(db: DB, symbols: string[]): Promise<void> {
  try {
    const directory = await loadDirectory(db).catch(() => []);
    const funds = new Set(directory.filter((listing) => listing.etf).map((listing) => listing.symbol));
    const needSec = symbols.filter((symbol) => !funds.has(symbol));
    const ciks = needSec.length > 0 ? await secTickers() : new Map<string, number>();

    for (const symbol of symbols) {
      let sector: Sector = "other";
      if (funds.has(symbol)) {
        sector = "funds";
      } else {
        const cik = ciks.get(symbol.replace(".", "-"));
        if (cik) {
          const sic = await secSic(cik);
          sector = sic === null ? "other" : sectorFromSic(sic);
          // The SEC allows ten requests a second; this stays well under.
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      await db.run(
        `INSERT INTO series_cache (key, payload, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
        [key(symbol), JSON.stringify(sector), new Date().toISOString()],
      );
    }
  } catch (error) {
    logger.warn("sectors.classify.failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Ticker to SEC company number, for every filer. Kept for a week. */
async function secTickers(): Promise<Map<string, number>> {
  const compact = await cachedSeries<Record<string, number>>("sec:tickers", 7 * 86_400_000, async () => {
    const response = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`SEC tickers ${response.status}`);
    const body = (await response.json()) as Record<string, { cik_str: number; ticker: string }>;
    return Object.fromEntries(Object.values(body).map((row) => [row.ticker, row.cik_str]));
  });
  return new Map(Object.entries(compact));
}

async function secSic(cik: number): Promise<number | null> {
  const response = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { sic?: string | number };
  const sic = Number(body.sic);
  return Number.isFinite(sic) ? sic : null;
}
