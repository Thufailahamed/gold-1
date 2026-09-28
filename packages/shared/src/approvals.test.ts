import { describe, expect, it } from "vitest";
import { isExpiredAsOf, thresholdBreached } from "./approvals";

describe("thresholdBreached", () => {
  it("fires strictly above the threshold", () => {
    expect(thresholdBreached(11, 10)).toBe(true);
    expect(thresholdBreached(10, 10)).toBe(false);
  });
  it("treats a missing threshold as disabled", () => {
    expect(thresholdBreached(999, null)).toBe(false);
  });
});

describe("isExpiredAsOf", () => {
  it("reads a past-due pending row as expired", () => {
    expect(isExpiredAsOf({ status: "PENDING", expires_at: 100 }, 101)).toBe(true);
    expect(isExpiredAsOf({ status: "PENDING", expires_at: 100 }, 100)).toBe(false);
    expect(isExpiredAsOf({ status: "APPROVED", expires_at: 100 }, 999)).toBe(false);
  });
});
