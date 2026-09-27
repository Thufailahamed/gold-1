import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";

describe("hasPermission", () => {
  it("allows exact match", () => {
    expect(hasPermission(["users:write"], "users:write")).toBe(true);
  });
  it("denies missing", () => {
    expect(hasPermission(["users:read"], "users:write")).toBe(false);
  });
});
