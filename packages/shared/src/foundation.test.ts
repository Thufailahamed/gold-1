import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";
import { changePasswordSchema, editUserSchema } from "./schemas";

describe("foundation matrix", () => {
  it("owner has every seeded permission", () => {
    const all = Object.values(PERMISSIONS);
    for (const p of all) expect(DEFAULT_ROLES["owner"]).toContain(p);
  });
  it("manufacturing_staff has products:view plus mfg workflow perms", () => {
    expect(DEFAULT_ROLES["manufacturing_staff"]).toEqual([
      "products:view",
      "mfg:view",
      "mfg:create",
      "mfg:edit",
    ]);
  });
  it("manager cannot approve users", () => {
    expect(DEFAULT_ROLES["manager"]).not.toContain("users:approve");
  });
  it("rejects short new password", () => {
    expect(() =>
      changePasswordSchema.parse({ currentPassword: "oldpass12", newPassword: "short" })
    ).toThrow();
  });
  it("editUser accepts role change payload", () => {
    const v = editUserSchema.parse({ role: "gold_officer", branchIds: ["b1"] });
    expect(v.role).toBe("gold_officer");
  });
});
