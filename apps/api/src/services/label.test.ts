import { describe, expect, it } from "vitest";
import { buildCodeSvg, buildLabelSvg, buildStickerSvg } from "./label";

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
  it("can leave the price off a stock tag", () => {
    const svg = buildLabelSvg(
      { barcode: "PRD-A3F9K2", name: "Ring", gross_weight: 5.2, net_weight: 5.0, karat: "22K" },
      { amount: 157500, ratePerGram: 28500, rateEffectiveFrom: 1759000000000 },
      { price: false }
    );
    expect(svg).not.toContain("157,500");
    expect(svg).not.toContain("LKR");
    expect(svg).toContain("PRD-A3F9K2");
    // Without the price line the tag is trimmed to the code, not left with a
    // blank strip that would waste label stock.
    expect(svg).toContain('viewBox="0 0 400 210"');
  });
});

describe("buildCodeSvg", () => {
  it("renders a scannable symbol for an invoice number", () => {
    const svg = buildCodeSvg("SINV-0042");
    expect(svg).toMatch(/^<svg[^>]*viewBox="[^"]+"/);
    expect(svg).toContain("<path");
  });
});

describe("buildStickerSvg", () => {
  it("splits into a barcode half on top and a number-and-weight half below, cut across the middle", () => {
    const svg = buildStickerSvg({ barcode: "RING-AA-0003", name: "Ring", gross_weight: 5.2, net_weight: 5.0, karat: "22K" });
    // Two boxes, stacked, with a cut line between them.
    expect(svg.match(/<rect x="3" y="\d+" width="294" height="69"/g)?.length).toBe(2);
    expect(svg).toContain('<line x1="0" y1="75" x2="300" y2="75"');
    // Top half: the bars, scaled into the top box.
    expect(svg).toContain('<svg x="40" y="14" width="220" height="46"');
    // Bottom half: the code number and both weights.
    expect(svg).toContain("RING-AA-0003");
    expect(svg).toContain("Gross 5.2 g · Net 5 g");
    // No QR code anywhere on the sticker.
    expect(svg).not.toMatch(/<svg x="14" y="14"/);
  });
});
