import { describe, expect, it } from "vitest";
import { hasChineseName, localizedName } from "@/lib/i18n/symbols";

describe("company names in Chinese", () => {
  it("translates a share the family holds", () => {
    expect(localizedName("NVDA", "NVIDIA Corp", "zh")).toBe("英伟达");
    expect(localizedName("GOOGL", "Alphabet Inc", "zh")).toBe("谷歌");
    expect(localizedName("AVGO", "Broadcom Inc", "zh")).toBe("博通");
  });

  it("leaves English alone", () => {
    expect(localizedName("NVDA", "NVIDIA Corp", "en")).toBe("NVIDIA Corp");
  });

  // A guessed translation reads as authoritative, so an unknown ticker keeps
  // the broker's own name rather than being invented.
  it("falls back to the broker's name when there is no settled Chinese one", () => {
    expect(localizedName("NBIS", "Nebius Group", "zh")).toBe("Nebius Group");
    expect(hasChineseName("NBIS")).toBe(false);
  });

  it("gives an option its underlying's name", () => {
    expect(localizedName("NVDA270115C00200000", "NVDA 250115 200 CALL", "zh")).toBe(
      "英伟达 看涨 200",
    );
    expect(localizedName("INTC270115P92500", undefined, "zh")).toBe("英特尔 看跌 92.5");
  });

  it("returns nothing when there is nothing to show", () => {
    expect(localizedName("ZZZZ", undefined, "zh")).toBeUndefined();
  });
});
