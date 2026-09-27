import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";
import { createGoldRateSchema, createPartySchema, createPuritySchema } from "./schemas";

describe("masters schemas", () => {
  it("rejects permille above 1000", () => {
    expect(() => createPuritySchema.parse({ karat: "22K", permille: 1500 })).toThrow();
  });
  it("rejects negative credit limit", () => {
    expect(() => createPartySchema.parse({ name: "X", creditLimit: -5 })).toThrow();
  });
  it("rejects zero gold rate", () => {
    expect(() =>
      createGoldRateSchema.parse({ purityId: "p1", ratePerGram: 0, effectiveFrom: Date.now() })
    ).toThrow();
  });
  it("grants masters:write to admin only (not cashier)", () => {
    expect(hasPermission(["users:read", "masters:read"], "masters:write")).toBe(false);
  });
});
