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
