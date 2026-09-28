import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function valuateOldGold(args: {
  netMg: number; permille: number; rateCentsPerG: number; buyPct: number;
  stoneDeductionCents: number; processingDeductionCents: number; negotiatedCents?: number;
}): { fineMg: number; grossValueCents: number; valueCents: number } {
  const fineMg = Math.round((args.netMg * args.permille) / 1000);
  const gross = Math.round(((fineMg * args.rateCentsPerG) / 1000) * (args.buyPct / 100));
  const value =
    args.negotiatedCents !== undefined
      ? args.negotiatedCents
      : gross - args.stoneDeductionCents - args.processingDeductionCents;
  if (value <= 0) throw new Error("value must be positive");
  return { fineMg, grossValueCents: gross, valueCents: value };
}

describe("old gold", () => {
  it("seeds oldgold permissions", () => {
    expect(PERMISSIONS.OLDGOLD_APPROVE).toBe("oldgold:approve");
    expect(DEFAULT_ROLES["gold_officer"]).toContain("oldgold:create");
    expect(DEFAULT_ROLES["gold_officer"]).not.toContain("oldgold:approve");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("oldgold:view");
  });
  it("values the spec example: 5g chain 22K @28500 buy 92% minus 2000", () => {
    const v = valuateOldGold({ netMg: 5000, permille: 916, rateCentsPerG: 2850000, buyPct: 92, stoneDeductionCents: 0, processingDeductionCents: 200000 });
    expect(v.fineMg).toBe(4580);
    expect(v.valueCents).toBe(11808760);
  });
  it("negotiated total overrides formula", () => {
    const v = valuateOldGold({ netMg: 5000, permille: 916, rateCentsPerG: 2850000, buyPct: 92, stoneDeductionCents: 0, processingDeductionCents: 0, negotiatedCents: 11500000 });
    expect(v.valueCents).toBe(11500000);
  });
});
