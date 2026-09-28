import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function meltDifference(inputMg: number, outputMg: number, wasteMg: number): { lossMg: number; recoveryMg: number } {
  const diff = inputMg - outputMg - wasteMg;
  return diff >= 0 ? { lossMg: diff, recoveryMg: 0 } : { lossMg: 0, recoveryMg: -diff };
}

export function lossPct(lossMg: number, inputMg: number): number {
  if (inputMg <= 0) throw new Error("input must be positive");
  return (lossMg / inputMg) * 100;
}

describe("gold ledger", () => {
  it("seeds gold permissions", () => {
    expect(PERMISSIONS.GOLD_VIEW).toBe("gold:view");
    expect(PERMISSIONS.GOLD_MANAGE).toBe("gold:manage");
    expect(DEFAULT_ROLES["gold_officer"]).toContain("gold:manage");
    expect(DEFAULT_ROLES["cashier"]).toContain("gold:view");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("gold:manage");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("gold:view");
  });
  it("reproduces the spec example: 7780 in, 7400 out, 200 waste", () => {
    const d = meltDifference(7780, 7400, 200);
    expect(d).toEqual({ lossMg: 180, recoveryMg: 0 });
    expect(lossPct(180, 7780)).toBeCloseTo(2.313, 2);
  });
  it("treats surplus as recovery", () => {
    expect(meltDifference(7000, 7100, 0)).toEqual({ lossMg: 0, recoveryMg: 100 });
  });
});
