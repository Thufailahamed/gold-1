import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function mfgBalance(allocatedMg: number, outputsMg: number, lossMg: number): boolean {
  return allocatedMg === outputsMg + lossMg;
}

describe("manufacturing", () => {
  it("seeds mfg permissions", () => {
    expect(PERMISSIONS.MFG_APPROVE).toBe("mfg:approve");
    expect(DEFAULT_ROLES["manufacturing_staff"]).toContain("mfg:create");
    expect(DEFAULT_ROLES["manufacturing_staff"]).toContain("mfg:edit");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("mfg:approve");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("mfg:view");
  });
  it("balances the spec example: 8000 in, 7500 out, 500 loss", () => {
    expect(mfgBalance(8000, 7500, 500)).toBe(true);
    expect(mfgBalance(8000, 7500, 400)).toBe(false);
  });
});
