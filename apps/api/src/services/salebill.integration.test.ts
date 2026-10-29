// A read sale bill is matched to stock: a barcode line to its product, a line
// with an old tag number by weight, a "New" line to old gold near its weight,
// and the customer by phone. Purities, categories and metal types are the migrations' seed.
import { beforeAll, describe, expect, it } from "vitest";
import { interpretSaleBill } from "../ai/salebill-scan";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("sale bill matching", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(() => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Other','OTH',0);
      INSERT INTO customers (id, code, name, phone, branch_id, created_at) VALUES ('c1','CUS-1','Riswan','+94 77 632 8343','b1',1);
      INSERT INTO products (id, barcode, sku, category_id, metal_type_id, purity_id, name, gross_mg, net_mg, branch_id, status, created_at) VALUES
        ('pr-ban','BAN-AA-0001','SKU-1','cat-bangle','metal-gold','purity-22k','Turkey Bangle',6590,6590,'b1','IN_STOCK',0),
        ('pr-pen','PEN-AA-0001','SKU-2','cat-chain','metal-gold','purity-22k','Turkey Pendant',4150,4150,'b1','IN_STOCK',0),
        ('pr-pen2','PEN-AA-0002','SKU-3','cat-chain','metal-gold','purity-22k','Plain Pendant',4200,4200,'b1','IN_STOCK',0),
        ('pr-sold','RIN-AA-0009','SKU-4','cat-ring','metal-gold','purity-22k','Sold Ring',2000,2000,'b1','SOLD',0);
      INSERT INTO old_gold_items (id, number, customer_id, branch_id, item_type, description, gross_mg, net_mg, purity_id, purchase_value_cents, status, created_at) VALUES
        ('og1','OG-0001','c1','b1','CHAIN','Lotus chain',12130,12130,'purity-22k',40000000,'AVAILABLE',0),
        ('og2','OG-0002','c1','b1','CHAIN','Old chain',12300,12300,'purity-22k',40000000,'AVAILABLE',0),
        ('og3','OG-0003','c1','b1','CHAIN','Held chain',12130,12130,'purity-22k',40000000,'RECEIVED',0);
    `);
  });

  const bill = (lines: { ref: string; description: string; weight: string; amount: string }[]) =>
    interpretSaleBill({ customer: { name: "Riswan", phone: "0776328343" }, date: "2026-10-29", lines, total: "", payments: [] }, "2026-10-29", "m");

  it("matches a barcode, an old tag by weight, a New line to old gold, and the customer", async () => {
    const { matchSaleBill } = await import("./salebill");
    const out = await matchSaleBill(
      db,
      "b1",
      bill([
        { ref: "BAN-AA-0001", description: "Turky Bangle", weight: "6x590", amount: "313000" },
        { ref: "1057", description: "Turky Pendent", weight: "4x150", amount: "211000" },
        { ref: "New", description: "Lotust chain", weight: "12x130", amount: "546000" },
      ])
    );
    expect(out.customerMatch).toMatchObject({ id: "c1", name: "Riswan" });
    expect(out.metalTypeId).toBe("metal-gold");

    expect(out.lines[0]).toMatchObject({ match: "barcode", product: { id: "pr-ban" }, warnings: [] });

    expect(out.lines[1]!.match).toBe("weight");
    expect(out.lines[1]!.product!.id).toBe("pr-pen");
    expect(out.lines[1]!.candidates.map((p) => p.id)).toEqual(["pr-pen", "pr-pen2"]);

    const og = out.lines[2]!;
    expect(og.fromOldGold).toBe(true);
    expect(og.product).toBeNull();
    // Only AVAILABLE old gold, nearest first.
    expect(og.oldGold.map((o) => o.number)).toEqual(["OG-0001", "OG-0002"]);
    expect(og.categoryId).toBe("cat-chain");
    expect(og.warnings).toEqual([]);
  });

  it("flags a sold piece, a wrong weight, an unknown barcode and a piece used twice", async () => {
    const { matchSaleBill } = await import("./salebill");
    const out = await matchSaleBill(
      db,
      "b1",
      bill([
        { ref: "RIN-AA-0009", description: "Ring", weight: "2x000", amount: "100000" },
        { ref: "BAN-AA-0001", description: "Bangle", weight: "7x000", amount: "313000" },
        { ref: "BAN-AA-0001", description: "Bangle", weight: "6x590", amount: "313000" },
        { ref: "XYZ-ZZ-9999", description: "Chain", weight: "", amount: "1000" },
      ])
    );
    expect(out.lines[0]!.warnings[0]).toContain("sold, not for sale");
    expect(out.lines[1]!.warnings[0]).toContain("but the bill says 7.000 g");
    expect(out.lines[2]!.product).toBeNull();
    expect(out.lines[2]!.warnings[0]).toContain("already on an earlier line");
    expect(out.lines[3]!.warnings[0]).toContain('No product has the barcode "XYZ-ZZ-9999"');
  });

  it("matches only stock at the bill's branch by weight", async () => {
    const { matchSaleBill } = await import("./salebill");
    const out = await matchSaleBill(db, "b2", bill([{ ref: "", description: "Bangle", weight: "6x590", amount: "313000" }]));
    expect(out.lines[0]).toMatchObject({ match: "none", product: null, candidates: [] });
  });
});
