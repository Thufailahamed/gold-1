import { describe, expect, it } from "vitest";
import { BARCODE_RE, createProductSchema } from "./schemas";

describe("product schema", () => {
  const valid = {
    name: "22K Wedding Ring",
    categoryId: "cat-ring",
    purityId: "purity-22k",
    grossWeight: 5.2,
    stoneWeight: 0.2,
    makingCharge: 15000,
    branchId: "branch-main",
  };
  it("accepts a valid product", () => {
    expect(createProductSchema.parse(valid).grossWeight).toBe(5.2);
  });
  it("rejects negative gross weight", () => {
    expect(() => createProductSchema.parse({ ...valid, grossWeight: -1 })).toThrow();
  });
  it("rejects negative stone weight", () => {
    expect(() => createProductSchema.parse({ ...valid, stoneWeight: -0.1 })).toThrow();
  });
  it("matches PRD- barcodes", () => {
    expect(BARCODE_RE.test("PRD-A3F9K2")).toBe(true);
    expect(BARCODE_RE.test("PRD-abc123")).toBe(false);
    expect(BARCODE_RE.test("OLD-ABC123")).toBe(false);
  });
});
