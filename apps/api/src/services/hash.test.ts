import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./hash";

describe("hash", () => {
  it("verifies correct password", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword("password123", hash)).toBe(true);
  });
  it("rejects wrong password", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });
});
