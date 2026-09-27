import { describe, expect, it } from "vitest";
import { buildLabelSvg } from "./label";

describe("buildLabelSvg", () => {
  it("embeds barcode, name, and price", () => {
    const svg = buildLabelSvg(
      {
        barcode: "PRD-A3F9K2",
        name: "22K Wedding Ring",
        gross_weight: 5.2,
        net_weight: 5.0,
        karat: "22K",
      },
      { amount: 157500, ratePerGram: 28500, rateEffectiveFrom: 1759000000000 }
    );
    expect(svg).toContain("PRD-A3F9K2");
    expect(svg).toContain("22K Wedding Ring");
    expect(svg).toContain("157,500");
    expect(svg.startsWith("<svg")).toBe(true);
  });
  it("renders without price when no rate", () => {
    const svg = buildLabelSvg(
      { barcode: "PRD-A3F9K2", name: "Ring", gross_weight: 5.2, net_weight: 5.0, karat: "22K" },
      null
    );
    expect(svg).toContain("NO RATE");
  });
});
