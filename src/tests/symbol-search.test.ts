import { describe, expect, it } from "vitest";
import { cleanName, parseDirectory, searchListings } from "@/lib/market/search";

// Lines as Nasdaq publishes them.
const NASDAQ = [
  "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
  "AAPL|Apple Inc. - Common Stock|Q|N|N|40|N|N",
  "MU|Micron Technology, Inc. - Common Stock|Q|N|N|40|N|N",
  "MUSA|Murphy USA Inc. Common Stock|N|N|N|100|N|N",
  "NBIS|Nebius Group N.V. - Class A Ordinary Shares|Q|N|N|100|N|N",
  "NVDA|NVIDIA Corporation - Common Stock|Q|N|N|100|N|N",
  "ZVZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N",
  "ABCDW|Abcd Holdings - Warrant|S|N|N|100|N|N",
  "File Creation Time: 0925202611:01|||||||",
].join("\n");
const OTHER = [
  "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
  "BRK.B|Berkshire Hathaway Inc. New Common Stock|N|BRK.B|N|40|N|BRK.B",
  "SPY|State Street SPDR S&P 500 ETF Trust|P|SPY|Y|40|N|SPY",
  "VOO|Vanguard S&P 500 ETF|P|VOO|Y|40|N|VOO",
  "ABR$D|Arbor Realty Trust 6.375% Series D Preferred|N|ABRpD|N|100|N|ABR-D",
].join("\n");

const listings = [...parseDirectory(NASDAQ, "nasdaq"), ...parseDirectory(OTHER, "other")];

describe("the symbol directory", () => {
  it("reads both of Nasdaq's files, without test issues or preferred lines", () => {
    const symbols = listings.map((l) => l.symbol);
    expect(symbols).toContain("NBIS");
    expect(symbols).toContain("BRK.B");
    expect(symbols).not.toContain("ZVZZT");
    expect(symbols).not.toContain("ABR$D");
    expect(listings.find((l) => l.symbol === "VOO")?.etf).toBe(true);
  });

  it("shows a name a person would say", () => {
    expect(cleanName("Apple Inc. - Common Stock")).toBe("Apple Inc.");
    expect(cleanName("Nebius Group N.V. - Class A Ordinary Shares")).toBe("Nebius Group N.V.");
    expect(cleanName("Berkshire Hathaway Inc. New Common Stock")).toBe("Berkshire Hathaway Inc.");
    expect(cleanName("Abcd Holdings - Warrant")).toBe("Abcd Holdings (Warrant)");
  });
});

describe("searching it", () => {
  const symbols = (query: string) => searchListings(listings, query).map((l) => l.symbol);

  it("finds a company by its name", () => {
    expect(symbols("micron")).toEqual(["MU"]);
    expect(symbols("Nebius")).toEqual(["NBIS"]);
    expect(symbols("berkshire")).toEqual(["BRK.B"]);
  });

  it("puts the exact ticker first, then tickers that start with it", () => {
    expect(symbols("mu")[0]).toBe("MU");
    expect(symbols("MU")).toEqual(["MU", "MUSA"]);
  });

  it("finds funds by what they track", () => {
    expect(symbols("s&p 500")).toEqual(["SPY", "VOO"]);
  });

  it("offers nothing rather than noise", () => {
    expect(symbols("")).toEqual([]);
    expect(symbols("zzzz")).toEqual([]);
  });
});
