import { describe, expect, it } from "vitest";
import { deriveStatus } from "./transfers";

describe("transfer document", () => {
  it("derives header status from line states", () => {
    expect(deriveStatus([{ status: "PENDING" }, { status: "PENDING" }])).toBe("REQUESTED");
    expect(deriveStatus([{ status: "IN_TRANSIT" }])).toBe("DISPATCHED");
    expect(deriveStatus([{ status: "RECEIVED" }, { status: "IN_TRANSIT" }])).toBe("PARTIAL");
    expect(deriveStatus([{ status: "RECEIVED" }, { status: "RECALLED" }])).toBe("COMPLETE");
  });
  it("refuses approval by the requester without touching stock", async () => {
    const { approveTransfer } = await import("./transfers");
    const db = {
      batch: async (..._a: unknown[]) => {},
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM transfers")) return { id: "t1", number: "TRF-000001", from_branch_id: "b1", to_branch_id: "b2", status: "REQUESTED", reason: null, requested_by: "u1", approved_by: null };
            if (sql.includes("FROM branch_members")) return { x: 1 };
            return null;
          },
          all: async () => {
            if (sql.includes("FROM user_roles")) return { results: [{ name: "products:cancel" }] };
            if (sql.includes("FROM transfer_lines")) return { results: [] };
            return { results: [] };
          },
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;
    await expect(approveTransfer(db, "t1", "u1", "u9")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects duplicate products at request validation", async () => {
    const { requestTransfer } = await import("./transfers");
    await expect(requestTransfer({} as D1Database, { fromBranchId: "b1", toBranchId: "b2", productIds: ["p1", "p1"] }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
