import { describe, expect, it } from "vitest";
import { hasPermission } from "@goldos/shared";

describe("requirePerm", () => {
  it("denies without permission", () => {
    expect(hasPermission([], "users:write")).toBe(false);
  });
});
