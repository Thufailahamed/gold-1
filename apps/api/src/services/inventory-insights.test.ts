import { describe, expect, it } from "vitest";

type Result = { results?: unknown[] } | undefined;

/**
 * D1 stub that dispatches on a marker substring of the SQL. Any statement the
 * test doesn't care about returns empty, so each test only declares the rows
 * it wants to assert on.
 */
function stubDb(overrides: Record<string, unknown[]>, scalars: Record<string, unknown> = {}) {
  return {
    prepare: (sql: string) => {
      const run = async () => {
        for (const [marker, rows] of Object.entries(overrides))
          if (sql.includes(marker)) return { results: rows };
        return { results: [] };
      };
      const first = async () => {
        for (const [marker, value] of Object.entries(scalars))
          if (sql.includes(marker)) return value;
        return null;
      };
      return {
        bind: () => ({
          first,
          all: async (): Promise<Result> => run(),
        }),
        first,
        all: async (): Promise<Result> => run(),
      };
    },
    batch: async (..._a: unknown[]) => {},
  } as unknown as D1Database;
}

const ZERO_TOTALS = { pieces: 0, net_mg: 0, fine_mg: 0, value_cents: 0 };
const ZERO_ATTENTION = {
  transfer_pending: 0,
  in_repair: 0,
  reserved: 0,
  last_movement_at: null,
  movements_24h: 0,
};

describe("priceStock", () => {
  it("uses the same rounding as stockSummary: round(net_mg * rate / 1000)", async () => {
    const { priceStock } = await import("./inventory");
    // 5000 mg at 14,000 cents/g = 70,000 cents. 4444 mg = 62,216 cents.
    expect(priceStock(5000, 14000)).toBe(70000);
    expect(priceStock(4444, 14000)).toBe(62216);
  });

  it("returns 0 for a missing rate rather than NaN", async () => {
    const { priceStock } = await import("./inventory");
    expect(priceStock(5000, undefined)).toBe(0);
  });
});

describe("inventoryInsights", () => {
  it("aggregates totals, byKarat and byBranch from in-stock rows", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      {
        "FROM products p": [
          {
            group_key: "pu22",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "22K",
            permille: 916,
            pieces: 2,
            net_mg: 5000,
            fine_mg: 4580,
            value_cents: 70000,
          },
          {
            group_key: "pu22",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "22K",
            permille: 916,
            pieces: 3,
            net_mg: 3000,
            fine_mg: 2748,
            value_cents: 42000,
          },
          {
            group_key: "pu18",
            branch_id: "b2",
            branch_name: "Kandy",
            karat: "18K",
            permille: 750,
            pieces: 1,
            net_mg: 2000,
            fine_mg: 1500,
            value_cents: 22000,
          },
        ],
      },
      {
        "COUNT(*) FILTER": { transfer_pending: 0, in_repair: 0, reserved: 0 },
        "MAX(created_at) AS last": { last: 1700000000000 },
        "COUNT(*) AS c24": { c24: 7 },
      }
    );

    const out = await inventoryInsights(db);

    expect(out.totals).toEqual({
      pieces: 6,
      net_mg: 10000,
      fine_mg: 8828,
      // 8000mg @14000 = 112000; 2000mg @11000 = 22000
      value_cents: 134000,
    });
    expect(out.byKarat).toEqual([
      {
        purity_id: "pu22",
        karat: "22K",
        permille: 916,
        pieces: 5,
        net_mg: 8000,
        fine_mg: 7328,
        value_cents: 112000,
      },
      {
        purity_id: "pu18",
        karat: "18K",
        permille: 750,
        pieces: 1,
        net_mg: 2000,
        fine_mg: 1500,
        value_cents: 22000,
      },
    ]);
    expect(out.byBranch).toEqual([
      {
        branch_id: "b1",
        name: "Colombo",
        pieces: 5,
        net_mg: 8000,
        fine_mg: 7328,
        value_cents: 112000,
      },
      {
        branch_id: "b2",
        name: "Kandy",
        pieces: 1,
        net_mg: 2000,
        fine_mg: 1500,
        value_cents: 22000,
      },
    ]);
    expect(out.attention).toEqual({
      transfer_pending: 0,
      in_repair: 0,
      reserved: 0,
      last_movement_at: 1700000000000,
      movements_24h: 7,
    });
  });

  it("takes value_cents from SQL so it matches stockSummary's per-product rounding", async () => {
    const { inventoryInsights } = await import("./inventory");
    // Two 1500mg pieces at 333 cents/g. Rounding per product then summing is
    // not the same as rounding the summed weight: the former is what
    // stockSummary produces and therefore what the stock table shows.
    const db = stubDb(
      {
        "FROM products p": [
          {
            group_key: "g1",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "9K",
            permille: 375,
            pieces: 1,
            net_mg: 1500,
            fine_mg: 562,
            value_cents: 499,
          },
          {
            group_key: "g1",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "9K",
            permille: 375,
            pieces: 1,
            net_mg: 1500,
            fine_mg: 562,
            value_cents: 499,
          },
        ],
      },
      {
        "COUNT(*) FILTER": { transfer_pending: 0, in_repair: 0, reserved: 0 },
        "MAX(created_at) AS last": { last: null },
        "COUNT(*) AS c24": { c24: 0 },
      }
    );

    const out = await inventoryInsights(db);

    // 998, not the 999 you would get by rounding 3000mg once.
    expect(out.totals.value_cents).toBe(998);
    expect(out.byKarat[0]!.value_cents).toBe(998);
  });

  it("prices a karat with no published rate at 0", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      {
        "FROM products p": [
          {
            group_key: "pu24",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "24K",
            permille: 999,
            pieces: 1,
            net_mg: 10000,
            fine_mg: 9990,
            value_cents: 0,
          },
        ],
      },
      {
        "COUNT(*) FILTER": { transfer_pending: 0, in_repair: 0, reserved: 0 },
        "MAX(created_at) AS last": { last: null },
        "COUNT(*) AS c24": { c24: 0 },
      }
    );

    const out = await inventoryInsights(db);

    expect(out.totals.value_cents).toBe(0);
    expect(out.byKarat[0]!.value_cents).toBe(0);
    expect(out.byBranch[0]!.value_cents).toBe(0);
  });

  it("returns zeroed totals and empty arrays when nothing is in stock", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      { "FROM products p": [] },
      {
        "COUNT(*) FILTER": { transfer_pending: 0, in_repair: 0, reserved: 0 },
        "MAX(created_at) AS last": { last: null },
        "COUNT(*) AS c24": { c24: 0 },
      }
    );

    expect(await inventoryInsights(db)).toEqual({
      totals: ZERO_TOTALS,
      byKarat: [],
      byBranch: [],
      attention: ZERO_ATTENTION,
    });
  });

  it("counts non-in-stock statuses into attention", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      { "FROM products p": [] },
      {
        "COUNT(*) FILTER": { transfer_pending: 4, in_repair: 2, reserved: 1 },
        "MAX(created_at) AS last": { last: 5 },
        "COUNT(*) AS c24": { c24: 3 },
      }
    );

    const out = await inventoryInsights(db);

    expect(out.attention.transfer_pending).toBe(4);
    expect(out.attention.in_repair).toBe(2);
    expect(out.attention.reserved).toBe(1);
    expect(out.attention.movements_24h).toBe(3);
  });
});
