import { describe, expect, it } from "vitest";
import { BARCODE_RE, createProductSchema } from "./schemas";

describe("product schema", () => {
  const valid = {
    name: "22K Wedding Ring",
    categoryId: "cat-ring",
    metalTypeId: "metal-gold",
    purityId: "purity-22k",
    grossG: 5.2,
    stoneG: 0.2,
    makingLkr: 15000,
    branchId: "branch-main",
  };
  it("accepts a valid product", () => {
    expect(createProductSchema.parse(valid).grossG).toBe(5.2);
  });
  it("rejects negative gross weight", () => {
    expect(() => createProductSchema.parse({ ...valid, grossG: -1 })).toThrow();
  });
  it("rejects negative stone weight", () => {
    expect(() => createProductSchema.parse({ ...valid, stoneG: -0.1 })).toThrow();
  });
  it("matches PRD- and JW- barcodes", () => {
    expect(BARCODE_RE.test("PRD-A3F9K2")).toBe(true);
    expect(BARCODE_RE.test("JW-A3F9K2")).toBe(true);
    expect(BARCODE_RE.test("PRD-abc123")).toBe(false);
    expect(BARCODE_RE.test("OLD-ABC123")).toBe(false);
  });
});
