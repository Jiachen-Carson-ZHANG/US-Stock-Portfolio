import { describe, expect, it } from "vitest";
import {
  HorizontalRoundedBar,
  VerticalRoundedBar,
} from "@/components/charts/rounded-bar";
import {
  compactUsd,
  makeCurrencyTick,
  shortSymbol,
} from "@/components/charts/chart-kit";

type PathElement = { props: { d: string; fill?: string } } | null;

function pathOf(element: unknown): string | null {
  const el = element as PathElement;
  return el?.props?.d ?? null;
}

describe("rounded bar shapes", () => {
  it("draws a bar for a positive value", () => {
    const d = pathOf(
      VerticalRoundedBar({ x: 0, y: 10, width: 20, height: 40, value: 100 }),
    );
    expect(d).toBeTruthy();
  });

  // Recharts passes negative geometry for bars below the baseline; dropping
  // those made loss positions render as nothing at all.
  it("draws a bar when height arrives negative", () => {
    const d = pathOf(
      VerticalRoundedBar({ x: 0, y: 50, width: 20, height: -40, value: -100 }),
    );
    expect(d).toBeTruthy();
    expect(d).not.toContain("NaN");
  });

  it("draws a bar when width arrives negative", () => {
    const d = pathOf(
      HorizontalRoundedBar({ x: 100, y: 0, width: -40, height: 20, value: -100 }),
    );
    expect(d).toBeTruthy();
    expect(d).not.toContain("NaN");
  });

  it("rounds opposite ends for gains and losses", () => {
    const gain = pathOf(
      VerticalRoundedBar({ x: 0, y: 10, width: 20, height: 40, value: 100 }),
    );
    const loss = pathOf(
      VerticalRoundedBar({ x: 0, y: 10, width: 20, height: 40, value: -100 }),
    );
    expect(gain).not.toEqual(loss);
  });

  it("renders nothing for a zero-extent bar", () => {
    expect(VerticalRoundedBar({ x: 0, y: 0, width: 0, height: 0 })).toBeNull();
    expect(HorizontalRoundedBar({ x: 0, y: 0, width: 10, height: 0 })).toBeNull();
  });
});

describe("axis labels", () => {
  it("renders an OCC option symbol as root, strike and side", () => {
    expect(shortSymbol("AAPL260116C00200000")).toBe("AAPL 200C");
    expect(shortSymbol("TSLA260320P00150000")).toBe("TSLA 150P");
  });

  it("leaves ordinary tickers alone", () => {
    expect(shortSymbol("AAPL")).toBe("AAPL");
    expect(shortSymbol("GOOGL")).toBe("GOOGL");
  });

  it("labels the cash line plainly", () => {
    expect(shortSymbol("USD.CASH")).toBe("Cash");
  });

  it("truncates anything else that would overflow an axis", () => {
    expect(shortSymbol("VERYLONGTICKERNAME")).toBe("VERYLONGT…");
  });
});

describe("compact currency", () => {
  it("abbreviates thousands and millions", () => {
    expect(compactUsd(1_250)).toBe("$1k");
    expect(compactUsd(2_400_000)).toBe("$2.4M");
    expect(compactUsd(-980)).toBe("-$980");
  });
});

describe("adaptive axis ticks", () => {
  // A narrow price band formatted compactly renders every tick as "$19".
  it("keeps cents on a narrow price range", () => {
    const tick = makeCurrencyTick(18.2, 19.4);
    expect(tick(18.2)).toBe("$18.20");
    expect(tick(19.4)).toBe("$19.40");
    expect(tick(18.2)).not.toBe(tick(19.4));
  });

  it("uses whole dollars on a mid-sized range", () => {
    const tick = makeCurrencyTick(3600, 4000);
    expect(tick(3730)).toBe("$3,730");
    expect(tick(3600)).not.toBe(tick(4000));
  });

  it("abbreviates a wide range", () => {
    const tick = makeCurrencyTick(79_000, 85_000);
    expect(tick(84_298)).toBe("$84k");
    expect(tick(79_000)).not.toBe(tick(85_000));
  });
});
