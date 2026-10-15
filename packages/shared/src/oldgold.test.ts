import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function valuateOldGold(args: {
  netMg: number; permille: number; rateCentsPerG: number; ratePermille: number; buyPct: number;
  stoneDeductionCents: number; processingDeductionCents: number; negotiatedCents?: number;
}): { fineMg: number; grossValueCents: number; valueCents: number } {
  const fineMg = Math.round((args.netMg * args.permille) / 1000);
  // Board rates are per gram of the rate purity, so fine gold converts back first.
  const gross = Math.round(((args.netMg * args.permille * args.rateCentsPerG) / (args.ratePermille * 1000)) * (args.buyPct / 100));
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
    expect(DEFAULT_ROLES["admin"]).toContain("oldgold:create");
    expect(DEFAULT_ROLES["admin"]).toContain("oldgold:approve");
    expect(DEFAULT_ROLES["staff"]).toContain("oldgold:create");
    expect(DEFAULT_ROLES["staff"]).not.toContain("oldgold:approve");
  });
  it("values the spec example: 5g chain 22K @28500 buy 92% minus 2000", () => {
    const v = valuateOldGold({ netMg: 5000, permille: 916, rateCentsPerG: 2850000, ratePermille: 916, buyPct: 92, stoneDeductionCents: 0, processingDeductionCents: 200000 });
    expect(v.fineMg).toBe(4580);
    expect(v.valueCents).toBe(12910000);
  });
  it("negotiated total overrides formula", () => {
    const v = valuateOldGold({ netMg: 5000, permille: 916, rateCentsPerG: 2850000, ratePermille: 916, buyPct: 92, stoneDeductionCents: 0, processingDeductionCents: 0, negotiatedCents: 11500000 });
    expect(v.valueCents).toBe(11500000);
  });
});
