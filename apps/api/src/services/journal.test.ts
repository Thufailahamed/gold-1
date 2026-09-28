import { describe, expect, it } from "vitest";
import { mirrorLines, nextEntryNo } from "./journal";

describe("mirrorLines", () => {
  it("swaps debit and credit", () => {
    const mirrored = mirrorLines([
      { account: "1100", debitCents: 500, creditCents: 0 },
      { account: "2000", debitCents: 0, creditCents: 500 },
    ]);
    expect(mirrored[0]).toMatchObject({ account: "1100", debitCents: 0, creditCents: 500 });
    expect(mirrored[1]).toMatchObject({ account: "2000", debitCents: 500, creditCents: 0 });
  });

  it("preserves the party tag on a mirrored line", () => {
    const mirrored = mirrorLines([
      { account: "1200", debitCents: 100, creditCents: 0, partyType: "customer", partyId: "c1" },
      { account: "4000", debitCents: 0, creditCents: 100 },
    ]);
    expect(mirrored[0]!.partyType).toBe("customer");
    expect(mirrored[0]!.partyId).toBe("c1");
  });

  it("still balances after mirroring", () => {
    const lines = mirrorLines([
      { account: "1000", debitCents: 100, creditCents: 0 },
      { account: "4000", debitCents: 0, creditCents: 100 },
    ]);
    expect(lines.reduce((s, l) => s + l.debitCents, 0)).toBe(
      lines.reduce((s, l) => s + l.creditCents, 0)
    );
  });

  it("omits party keys on a line that had none", () => {
    const mirrored = mirrorLines([{ account: "1000", debitCents: 1, creditCents: 0 }]);
    expect("partyType" in mirrored[0]!).toBe(false);
  });
});

describe("nextEntryNo", () => {
  it("pads to six digits", () => {
    expect(nextEntryNo(1)).toBe("JE-000001");
    expect(nextEntryNo(42)).toBe("JE-000042");
  });

  it("does not truncate past six digits", () => {
    expect(nextEntryNo(1_234_567)).toBe("JE-1234567");
  });
});
