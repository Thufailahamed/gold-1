import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

function allocateCharges(totalCharges: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) throw new Error("weights must be positive");
  const shares = weights.map((w) => Math.floor((totalCharges * w) / total));
  shares[0] = (shares[0] ?? 0) + totalCharges - shares.reduce((s, x) => s + x, 0);
  return shares;
}

describe("purchases", () => {
  it("seeds purchase permissions", () => {
    expect(PERMISSIONS.PURCHASES_CREATE).toBe("purchases:create");
    expect(DEFAULT_ROLES["owner"]).toContain("purchases:cancel");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("purchases:view");
  });
  it("allocates charges by weight summing to total", () => {
    expect(allocateCharges(5000, [5000, 2500, 2500])).toEqual([2500, 1250, 1250]);
    const shares = allocateCharges(100, [1, 1, 1]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(100);
  });
  it("rejects empty weights", () => {
    expect(() => allocateCharges(100, [])).toThrow();
  });
});
