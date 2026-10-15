import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";
import { createPartySchema } from "./schemas";

describe("ledger perms", () => {
  it("seeds accounts permissions", () => {
    expect(PERMISSIONS.ACCOUNTS_VIEW).toBe("accounts:view");
    expect(PERMISSIONS.ACCOUNTS_MANAGE).toBe("accounts:manage");
  });
  it("only owner manages accounts", () => {
    expect(DEFAULT_ROLES["owner"]).toContain("accounts:manage");
    expect(DEFAULT_ROLES["admin"]).not.toContain("accounts:manage");
    expect(DEFAULT_ROLES["staff"]).not.toContain("accounts:manage");
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
