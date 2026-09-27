import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";
import { createGoldRateSchema, createPartySchema, createPuritySchema } from "./schemas";

describe("masters schemas", () => {
  it("rejects purity above 1", () => {
    expect(() => createPuritySchema.parse({ karat: "22K", purity: 1.5 })).toThrow();
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
