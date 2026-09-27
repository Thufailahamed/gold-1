import { describe, expect, it } from "vitest";
import { createUserSchema } from "@goldos/shared";

describe("createUser", () => {
  it("rejects short password", () => {
    expect(() =>
      createUserSchema.parse({
        email: "a@b.com",
        name: "A",
        password: "short",
        role: "cashier",
        branchId: "b1",
      })
    ).toThrow();
  });
});
