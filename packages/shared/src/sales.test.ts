import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function discountPct(discountCents: number, subtotalCents: number): number {
  if (subtotalCents <= 0) throw new Error("subtotal must be positive");
  return (discountCents / subtotalCents) * 100;
}

describe("sales", () => {
  it("seeds sales permissions", () => {
    expect(PERMISSIONS.SALES_APPROVE).toBe("sales:approve");
    expect(DEFAULT_ROLES["cashier"]).toContain("sales:create");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("sales:approve");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("sales:view");
  });
  it("computes discount percent", () => {
    expect(discountPct(10000, 200000)).toBe(5);
  });
  it("splits sum to total", () => {
    const parts = [100000, 150000, 90000];
    expect(parts.reduce((s, x) => s + x, 0)).toBe(340000);
  });
});
