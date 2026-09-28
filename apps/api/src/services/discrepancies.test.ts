import { describe, expect, it } from "vitest";

describe("discrepancy csv", () => {
  it("quotes fields and prepends the live-read preamble", async () => {
    const { toCsv } = await import("./discrepancies");
    const out = toCsv(["generated_at: x"], ["barcode", "note"], [{ barcode: "JW-1", note: 'a"b,c' }]);
    expect(out).toContain("# generated_at: x");
    expect(out).toContain('"a""b,c"');
  });
});

describe("unreceived threshold", () => {
  it("defaults to 3 when unset and floors custom values", async () => {
    const { unreceivedDays } = await import("./discrepancies");
    const empty = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as D1Database;
    expect(await unreceivedDays(empty)).toBe(3);
    const custom = { prepare: () => ({ bind: () => ({ first: async () => ({ key: "transfer_unreceived_days", value_json: "5", type: "number" }) }) }) } as unknown as D1Database;
    expect(await unreceivedDays(custom)).toBe(5);
  });
  it("ignores non-numeric settings", async () => {
    const { unreceivedDays } = await import("./discrepancies");
    const bad = { prepare: () => ({ bind: () => ({ first: async () => ({ key: "transfer_unreceived_days", value_json: '"soon"', type: "string" }) }) }) } as unknown as D1Database;
    expect(await unreceivedDays(bad)).toBe(3);
  });
});

describe("unreceived exclusions", () => {
  it("flags only old in-transit lines", async () => {
    const { unreceivedReport } = await import("./discrepancies");
    const old = Date.now() - 10 * 86_400_000;
    const young = Date.now() - 1 * 86_400_000;
    const db = {
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => null,
          all: async () => {
            if (sql.includes("FROM transfer_lines")) return { results: [
              { transfer_id: "t1", number: "TRF-000001", product_id: "p1", barcode: "JW-1", from_branch_id: "b1", to_branch_id: "b2", dispatched_at: old },
              { transfer_id: "t1", number: "TRF-000001", product_id: "p2", barcode: "JW-2", from_branch_id: "b1", to_branch_id: "b2", dispatched_at: young },
            ] };
            return { results: [] };
          },
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
      batch: async (..._a: unknown[]) => {},
    } as unknown as D1Database;
    const r = await unreceivedReport(db, "b1");
    expect(r.thresholdDays).toBe(3);
    expect(r.rows.map((x) => x.barcode)).toEqual(["JW-1"]);
    expect(r.hasData).toBe(true);
  });
});
