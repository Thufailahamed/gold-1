import { describe, expect, it } from "vitest";

describe("discrepancy csv", () => {
  it("quotes fields and prepends the live-read preamble", async () => {
    const { toCsv } = await import("./discrepancies");
    const out = toCsv(["generated_at: x"], ["barcode", "note"], [{ barcode: "JW-1", note: 'a"b,c' }]);
    expect(out).toContain("# generated_at: x");
    expect(out).toContain('"a""b,c"');
  });
});
