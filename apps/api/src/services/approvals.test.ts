import { describe, expect, it } from "vitest";
import { decideGuard } from "./approvals";

describe("decideGuard", () => {
  it("rejects self-decision", () => {
    expect(decideGuard({ status: "PENDING", requester_id: "u1", expires_at: 999 }, "u1", 10)).toBe("FORBIDDEN");
  });
  it("rejects deciding expired requests", () => {
    expect(decideGuard({ status: "PENDING", requester_id: "u1", expires_at: 100 }, "u2", 101)).toBe("CONFLICT");
  });
  it("rejects double decisions", () => {
    expect(decideGuard({ status: "APPROVED", requester_id: "u1", expires_at: 999 }, "u2", 10)).toBe("CONFLICT");
  });
  it("allows a valid decision", () => {
    expect(decideGuard({ status: "PENDING", requester_id: "u1", expires_at: 999 }, "u2", 10)).toBe(null);
  });
});
