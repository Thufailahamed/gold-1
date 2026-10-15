import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";
import { changePasswordSchema, editUserSchema } from "./schemas";

describe("foundation matrix", () => {
  it("owner has every seeded permission", () => {
    const all = Object.values(PERMISSIONS);
    for (const p of all) expect(DEFAULT_ROLES["owner"]).toContain(p);
  });
  it("has exactly three roles: owner, admin, staff", () => {
    expect(Object.keys(DEFAULT_ROLES).sort()).toEqual(["admin", "owner", "staff"]);
  });
  it("seeds dayclose permissions", () => {
    expect(PERMISSIONS.DAYCLOSE_VIEW).toBe("dayclose:view");
    expect(PERMISSIONS.DAYCLOSE_MANAGE).toBe("dayclose:manage");
    expect(DEFAULT_ROLES["owner"]).toContain("dayclose:view");
    expect(DEFAULT_ROLES["owner"]).toContain("dayclose:manage");
    expect(DEFAULT_ROLES["admin"]).toContain("dayclose:manage");
    expect(DEFAULT_ROLES["staff"]).toContain("dayclose:manage");
  });
  it("only owner sees final accounts and profits", () => {
    expect(DEFAULT_ROLES["owner"]).toContain("accounts:view");
    expect(DEFAULT_ROLES["owner"]).toContain("accounts:manage");
    expect(DEFAULT_ROLES["admin"]).not.toContain("accounts:view");
    expect(DEFAULT_ROLES["admin"]).not.toContain("accounts:manage");
    expect(DEFAULT_ROLES["staff"]).not.toContain("accounts:view");
    expect(DEFAULT_ROLES["staff"]).not.toContain("accounts:manage");
  });
  it("staff can sell and close the day, but cannot manage users or reopen", () => {
    expect(DEFAULT_ROLES["staff"]).toContain("sales:create");
    expect(DEFAULT_ROLES["staff"]).toContain("dayclose:manage");
    expect(DEFAULT_ROLES["staff"]).not.toContain("users:edit");
    expect(DEFAULT_ROLES["staff"]).not.toContain("users:approve");
  });
  it("admin cannot approve users or branches", () => {
    expect(DEFAULT_ROLES["admin"]).not.toContain("users:approve");
    expect(DEFAULT_ROLES["admin"]).not.toContain("branches:approve");
  });
  it("rejects short new password", () => {
    expect(() =>
      changePasswordSchema.parse({ currentPassword: "oldpass12", newPassword: "short" })
    ).toThrow();
  });
  it("editUser accepts role change payload", () => {
    const v = editUserSchema.parse({ role: "admin", branchIds: ["b1"] });
    expect(v.role).toBe("admin");
  });
  it("rejects legacy roles", () => {
    expect(() => editUserSchema.parse({ role: "manager" })).toThrow();
    expect(() => editUserSchema.parse({ role: "cashier" })).toThrow();
  });
});
