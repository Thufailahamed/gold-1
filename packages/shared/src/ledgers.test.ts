import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";
import { createPartySchema } from "./schemas";

describe("ledger perms", () => {
  it("seeds accounts permissions", () => {
    expect(PERMISSIONS.ACCOUNTS_VIEW).toBe("accounts:view");
    expect(PERMISSIONS.ACCOUNTS_MANAGE).toBe("accounts:manage");
  });
  it("accountant can manage accounts, cashier cannot", () => {
    expect(DEFAULT_ROLES["accountant"]).toContain("accounts:manage");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("accounts:manage");
  });
  it("owner holds all permissions", () => {
    for (const p of Object.values(PERMISSIONS)) expect(DEFAULT_ROLES["owner"]).toContain(p);
  });
  it("party schema no longer accepts an opening balance", () => {
    const v = createPartySchema.parse({ name: "X", branchId: "b1", notes: "prefers SMS" });
    expect(v.notes).toBe("prefers SMS");
    expect((v as Record<string, unknown>).openingBalance).toBeUndefined();
  });
});
