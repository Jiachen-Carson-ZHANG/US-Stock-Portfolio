import { describe, expect, it } from "vitest";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

type Node = { [key: string]: string | Node };

function flatten(node: Node, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const flat = Object.fromEntries(
  Object.entries(dictionaries).map(([locale, dictionary]) => [
    locale,
    flatten(dictionary as unknown as Node),
  ]),
) as Record<Locale, Map<string, string>>;

/**
 * Strings that are the same in both languages on purpose: product names,
 * tickers, symbols and punctuation. Anything not listed here and identical
 * across locales is an English string that was never translated.
 */
const SAME_BY_DESIGN = new Set([
  "appName",
  "common.none",
  "nav.language",
  "market.preMarket",
  "ai.provider",
  // "ETF" is written the same way in Chinese.
  "instrument.etf",
  // Delta and Theta are written as the Greek letters on Chinese trading
  // screens too. Translating them would be less recognisable, not more.
  "trade.delta",
  "trade.theta",
]);

describe("the two dictionaries", () => {
  it("describe exactly the same set of strings", () => {
    const english = [...flat.en.keys()].sort();
    const chinese = [...flat.zh.keys()].sort();

    // TypeScript already refuses a missing key, because Dictionary is
    // typeof en. It does not catch a key added to zh alone, and it cannot
    // report the whole list at once, which is what makes a failure useful.
    expect(chinese).toEqual(english);
  });

  it("has no empty strings", () => {
    for (const [locale, entries] of Object.entries(flat)) {
      for (const [key, value] of entries) {
        expect(value.trim(), `${locale}.${key} is empty`).not.toBe("");
      }
    }
  });

  // The failure this catches: someone adds a section to `en`, copies it into
  // `zh` to make the compiler happy, and ships English text to Chinese
  // readers. The compiler is satisfied; the reader is not.
  it("has no English left sitting in the Chinese dictionary", () => {
    const untranslated: string[] = [];

    for (const [key, english] of flat.en) {
      if (SAME_BY_DESIGN.has(key)) continue;
      const chinese = flat.zh.get(key);
      if (chinese === undefined) continue;
      // A string with no Chinese characters at all, identical to the
      // English, was copied rather than translated.
      if (chinese === english && !/[一-鿿]/.test(chinese)) {
        untranslated.push(`${key}: "${english}"`);
      }
    }

    expect(untranslated, `Untranslated:\n  ${untranslated.join("\n  ")}`).toEqual([]);
  });

  it("translates anything long enough to be a sentence", () => {
    const suspicious: string[] = [];

    for (const [key, chinese] of flat.zh) {
      if (SAME_BY_DESIGN.has(key)) continue;
      // Long Chinese values with no Chinese characters are English prose
      // that slipped through, even where the English differs slightly.
      if (chinese.length > 12 && !/[一-鿿]/.test(chinese)) {
        suspicious.push(`${key}: "${chinese}"`);
      }
    }

    expect(suspicious, `Looks like English:\n  ${suspicious.join("\n  ")}`).toEqual([]);
  });
});
