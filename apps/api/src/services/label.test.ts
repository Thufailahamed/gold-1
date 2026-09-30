import { describe, expect, it } from "vitest";
import { buildCodeSvg, buildLabelSvg } from "./label";

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
  it("scales the symbol by its own viewBox so edges are not clipped", () => {
    const svg = buildLabelSvg(
      { barcode: "JW-M2Q39H", name: "Ring", gross_weight: 5.2, net_weight: 5.0, karat: "22K" },
      null
    );
    const nested = svg.match(/<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" viewBox="0 0 (\d+) (\d+)" preserveAspectRatio="xMidYMid meet">/);
    expect(nested).not.toBeNull();
    // Every bar must sit inside the nested viewBox.
    const width = Number(nested![1]);
    const xs = [...svg.matchAll(/M(\d+(?:\.\d+)?) /g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(width);
  });
  it("escapes markup in product names", () => {
    const svg = buildLabelSvg(
      { barcode: "JW-M2Q39H", name: "Ring <b>&\"x\"", gross_weight: 1, net_weight: 1, karat: "22K" },
      null
    );
    expect(svg).toContain("Ring &lt;b&gt;&amp;&quot;x&quot;");
  });
  it("renders without price when no rate", () => {
    const svg = buildLabelSvg(
      { barcode: "PRD-A3F9K2", name: "Ring", gross_weight: 5.2, net_weight: 5.0, karat: "22K" },
      null
    );
    expect(svg).toContain("NO RATE");
  });
});

describe("buildCodeSvg", () => {
  it("renders a scannable symbol for an invoice number", () => {
    const svg = buildCodeSvg("SINV-0042");
    expect(svg).toMatch(/^<svg[^>]*viewBox="[^"]+"/);
    expect(svg).toContain("<path");
  });
});
