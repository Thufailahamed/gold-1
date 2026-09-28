import { describe, expect, it } from "vitest";

describe("heldGoldStages", () => {
  it("sums stages to the held total", async () => {
    const { heldGoldStages } = await import("./reconcile");
    const byFragment: [string, number][] = [
      ["FROM products", 1000],
      ["FROM old_gold_items", 200],
      ["FROM melting_outputs", 0],
      ["manufacturing_materials m", 300],
      ["type = 'RECOVERY'", 50],
    ];
    const db = {
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("SUM(o.fine_mg)")) return { total: 500, allocated: 100 };
            for (const [frag, val] of byFragment) if (sql.includes(frag)) return { fine_mg: val };
            return null;
          },
        }),
        first: async () => null,
      }),
    } as unknown as D1Database;
    const s = await heldGoldStages(db, "b1");
    expect(s.products).toBe(1000);
    expect(s.oldGold).toBe(200);
    expect(s.lots).toBe(400);
    expect(s.wip).toBe(300);
    expect(s.recovered).toBe(50);
    expect(s.total).toBe(1950);
  });
});

const UNIVERSAL = { n: 0, fine_mg: 0, total: 0, allocated: 0, dr: 0, cr: 0, g: 0, c: 0, r: 0, p: 0, pend: 0, pieces: 0, netMg: 0, costCents: 0, mg: 0 };

function overviewDb(opts?: { member?: boolean; branches?: { id: string }[] }) {
  const member = opts?.member ?? true;
  return {
      prepare: (sql: string) => ({
        bind: (...v: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM branch_members")) return member ? { x: 1 } : null;
            if (sql.includes("FROM branches WHERE id")) return { id: String(v[0] ?? "b1"), name: `Branch ${String(v[0] ?? "b1")}` };
            if (sql.includes("SUM(cost_cents)")) return { pieces: 2, netMg: 10000, fineMg: 9160, costCents: 50000 };
            return UNIVERSAL;
          },
        all: async () => {
          if (sql.includes("FROM branches WHERE is_active")) return { results: opts?.branches ?? [{ id: "b1" }] };
          if (sql.includes("FROM users")) return { results: [{ name: "Asha", roles: "owner" }] };
          return { results: [] };
        },
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  } as unknown as D1Database;
}

describe("branchOverview guards", () => {
  it("keeps transit out of shelf figures and names staff for members", async () => {
    const { branchOverview } = await import("./overview");
    const v = await branchOverview(overviewDb(), "b1", { year: 2026, month: 9, userId: "u1", permissions: ["branches:view"] });
    expect(v.jewellery.pieces).toBe(2);
    expect(v.transit.linesOut.count).toBe(0);
    expect(v.staff).toEqual([{ name: "Asha", roles: ["owner"] }]);
    expect(v.month).toBe("2026-09");
  });
  it("redacts staff for manage-holders outside the branch without users:view", async () => {
    const { branchOverview } = await import("./overview");
    const v = await branchOverview(overviewDb({ member: false }), "b1", { year: 2026, month: 9, userId: "u9", permissions: ["branches:view", "branches:manage"] });
    expect(v.staff).toEqual({ redacted: true });
  });
  it("matches the monthly engine on the same inputs", async () => {
    const { branchOverview } = await import("./overview");
    const { buildMonthlyReport } = await import("./monthly");
    const db = overviewDb();
    const v = await branchOverview(db, "b1", { year: 2026, month: 9, userId: "u1", permissions: ["branches:view"] });
    const m = await buildMonthlyReport(db, { month: 9, year: 2026, branchId: "b1" });
    expect(v.sales.netCents).toBe(m.sales.netCents);
    expect(v.sales.invoiceCount).toBe(m.sales.invoiceCount);
  });
});

describe("allBranches no-mix", () => {
  it("returns an array with no total key", async () => {
    const { allBranches } = await import("./overview");
    const r = await allBranches(overviewDb({ branches: [{ id: "b1" }, { id: "b2" }] }), { year: 2026, month: 9, userId: "u1", permissions: ["branches:manage"] });
    expect(r.branches.map((b) => b.branch.id)).toEqual(["b1", "b2"]);
    expect(JSON.stringify(r)).not.toContain('"total"');
  });
  it("refuses manage-less callers", async () => {
    const { allBranches } = await import("./overview");
    await expect(allBranches(overviewDb(), { year: 2026, month: 9, userId: "u1", permissions: ["branches:view"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
