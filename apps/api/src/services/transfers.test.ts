import { describe, expect, it } from "vitest";
import { deriveStatus } from "./transfers";

describe("transfer document", () => {
  it("derives header status from line states", () => {
    expect(deriveStatus([{ status: "PENDING" }, { status: "PENDING" }])).toBe("REQUESTED");
    expect(deriveStatus([{ status: "IN_TRANSIT" }])).toBe("DISPATCHED");
    expect(deriveStatus([{ status: "RECEIVED" }, { status: "IN_TRANSIT" }])).toBe("PARTIAL");
    expect(deriveStatus([{ status: "RECEIVED" }, { status: "RECALLED" }])).toBe("COMPLETE");
  });
  it("rejects duplicate products at request validation", async () => {
    const { requestTransfer } = await import("./transfers");
    await expect(requestTransfer({} as D1Database, { fromBranchId: "b1", toBranchId: "b2", productIds: ["p1", "p1"] }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
