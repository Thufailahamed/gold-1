// Regression test for the day-close blocker found live on 2026-10-12: products
// taken in directly (no purchase invoice, no manufacturing order) were created
// before the OPENING gold row posting existed, so the ledger never saw their
// metal. gold_stock_consistency failed by exactly their fine weight and every
// day close was blocked. backfillIntakeLedger() inserts the missing OPENING
// rows — only for products that have none — and is therefore idempotent.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("intake ledger backfill over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  let today: string;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T;

  const ledgerMg = (branch = "b1") =>
    (
      raw
        .prepare(
          `SELECT COALESCE(SUM(
             (CASE WHEN destination LIKE 'branch:%' AND destination = 'branch:' || ? THEN fine_mg ELSE 0 END)
           - (CASE WHEN source LIKE 'branch:%' AND source = 'branch:' || ? THEN fine_mg ELSE 0 END)
           ), 0) AS mg FROM gold_ledger`
        )
        .get(branch, branch) as { mg: number }
    ).mg;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO categories (id, name, code, created_at) VALUES ('cat1','Bangles','BNG',0);
      INSERT OR IGNORE INTO metal_types (id, name, code, created_at) VALUES ('metal-gold','Gold','GOLD',0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
  });

  const addDirectIntake = (id: string, name: string, barcode: string, netMg: number, fineMg: number, createdAt: number, status = "IN_STOCK") => {
    raw.prepare(
      `INSERT INTO products (id, barcode, category_id, purity_id, name, gross_mg, stone_mg, net_mg, fine_gold_mg, cost_cents, status, branch_id, created_at, created_by)
       VALUES (?, ?, 'cat1', 'purity-22k', ?, ?, 0, ?, ?, 1000000, ?, 'b1', ?, 'u1')`
    ).run(id, barcode, name, netMg, netMg, fineMg, status, createdAt);
  };

  it("inserts an OPENING inflow for every direct-intake product that has none, making gold_stock_consistency pass", async () => {
    addDirectIntake("pr1", "22K Bangle", "BC-0001", 12500, 11450, 1000);
    addDirectIntake("pr2", "Bought directly", "BC-0002", 5000, 4580, 2000);
    // Sold direct intake: its intake row is still required — its SALE row
    // already leaves the branch, so without the intake the ledger is short by
    // the sold weight forever. Held stock excludes it; the intake restores
    // exactly the weight the sale took out.
    addDirectIntake("pr3", "Sold piece", "BC-0003", 4000, 3664, 3000, "SOLD");
    raw.prepare(
      `INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, user_id, created_at, created_by)
       VALUES ('sale1', 3000, 'b1', 'branch:b1', 'customer:unknown', 'SALE', 4000, 916, 3664, 'sale_invoice', 's1', 'pr3', 'u1', 3000, 'u1')`
    ).run();
    // The only ledger movement is the sale leaving; no intake ever came in.
    expect(ledgerMg()).toBe(-3664);

    const svc = await import("./openingstock");
    const report = await svc.backfillIntakeLedger(db, "u1");
    expect(report.posted.map((p) => p.productId).sort()).toEqual(["pr1", "pr2", "pr3"]);

    // One OPENING row per product, dated to the product's intake.
    const rows = raw
      .prepare(
        `SELECT product_id, fine_mg, source, destination, ref_entity FROM gold_ledger
         WHERE type = 'OPENING' AND ref_entity = 'product_intake' ORDER BY fine_mg DESC`
      )
      .all() as { product_id: string; fine_mg: number; source: string; destination: string; ref_entity: string }[];
    expect(rows).toEqual([
      { product_id: "pr1", fine_mg: 11450, source: "opening", destination: "branch:b1", ref_entity: "product_intake" },
      { product_id: "pr2", fine_mg: 4580, source: "opening", destination: "branch:b1", ref_entity: "product_intake" },
      { product_id: "pr3", fine_mg: 3664, source: "opening", destination: "branch:b1", ref_entity: "product_intake" },
    ]);

    // The gate passes for the branch afterwards.
    const { reconcile } = await import("./reconcile");
    const r = await reconcile(db, { date: today, branchId: "b1" });
    const stock = r.checks.find((c) => c.id === "gold_stock_consistency")!;
    expect(stock.pass).toBe(true);
    expect(stock.difference).toBe(0);
  });

  it("is idempotent: products that already carry an intake row are skipped, nothing posted twice", async () => {
    const svc = await import("./openingstock");
    const before = ledgerMg();
    const count = (raw.prepare("SELECT COUNT(*) AS n FROM gold_ledger WHERE type = 'OPENING'").get() as { n: number }).n;
    const report = await svc.backfillIntakeLedger(db, "u1");
    expect(report.posted).toEqual([]);
    expect(ledgerMg()).toBe(before);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM gold_ledger WHERE type = 'OPENING'").get() as { n: number }).n).toBe(count);
  });

  it("invoice-owned products get exactly one PURCHASE row — no second OPENING intake", async () => {
    // pr5 has a received invoice document with an item but no PURCHASE gold
    // row (the pre-fix deployment gap). The OPENING bucket skips it — the
    // invoice owns the intake — and the invoice bucket posts the one row the
    // day cross-foot matches against the invoice.
    addDirectIntake("pr5", "Bought on invoice", "BC-0005", 3000, 2748, 6000);
    raw.exec(`
      INSERT INTO suppliers (id, name, branch_id, created_at) VALUES ('sup1','Supplier','b1',0);
      INSERT INTO purchase_invoices (id, number, supplier_id, branch_id, subtotal_cents, total_cents, status, created_at, created_by)
        VALUES ('pinv1','PINV-0001','sup1','b1',1000000,1000000,'RECEIVED',0,'u1');
      INSERT INTO purchase_invoice_items (id, invoice_id, product_id, gross_mg, net_mg, purity_id, cost_cents)
        VALUES ('pi5','pinv1','pr5',3000,3000,'purity-22k',1000000);
    `);
    const svc = await import("./openingstock");
    const before = ledgerMg();
    const report = await svc.backfillIntakeLedger(db, "u1");
    expect(report.posted).toEqual([
      { productId: "pr5", barcode: "BC-0005", type: "PURCHASE", refId: "pinv1", fineMg: 2748 },
    ]);
    // Exactly one inflow, of the PURCHASE kind.
    const rows = raw
      .prepare(`SELECT type, COUNT(*) AS n FROM gold_ledger WHERE product_id = 'pr5' GROUP BY type ORDER BY n DESC`)
      .all() as { type: string; n: number }[];
    expect(rows).toEqual([{ type: "PURCHASE", n: 1 }]);
    expect(ledgerMg()).toBe(before + 2748);
  });

  it("posts missing PURCHASE rows for a received invoice whose gold posting never happened", async () => {
    // Remote incident: the invoice's money journal was POSTED, the invoice is
    // PAID and its item's product IN_STOCK, but the PURCHASE gold row was
    // never written by the deployed receive() of the day. The OPENING bucket
    // correctly skips the product (it has an invoice document); the invoice
    // bucket posts the PURCHASE row the day cross-foot needs.
    addDirectIntake("pr6", "Invoice-bought piece", "BC-0006", 5000, 4580, 7000);
    raw.exec(`
      INSERT INTO suppliers (id, name, branch_id, created_at) VALUES ('sup2','Supplier2','b1',0);
      INSERT INTO purchase_invoices (id, number, supplier_id, branch_id, subtotal_cents, total_cents, paid_cents, status, created_at, created_by)
        VALUES ('pinv2','PINV-0002','sup2','b1',15000000,15000000,15000000,'PAID',18000,'u1');
      INSERT INTO purchase_invoice_items (id, invoice_id, product_id, gross_mg, net_mg, purity_id, cost_cents)
        VALUES ('pi6','pinv2','pr6',5000,5000,'purity-22k',15000000);
    `);
    const svc = await import("./openingstock");
    const report = await svc.backfillIntakeLedger(db, "u1");
    expect(report.posted).toEqual([
      { productId: "pr6", barcode: "BC-0006", type: "PURCHASE", refId: "pinv2", fineMg: 4580 },
    ]);
    const row = raw
      .prepare(
        `SELECT type, source, destination, fine_mg, ref_entity, ref_id, product_id FROM gold_ledger
         WHERE ref_id = 'pinv2'`
      )
      .get() as { type: string; source: string; destination: string; fine_mg: number; ref_entity: string; ref_id: string; product_id: string };
    expect(row).toEqual({
      type: "PURCHASE",
      source: "purchase:PINV-0002",
      destination: "branch:b1",
      fine_mg: 4580,
      ref_entity: "purchase_invoice",
      ref_id: "pinv2",
      product_id: "pr6",
    });
  });

  it("is fully idempotent across both buckets: a re-run posts nothing", async () => {
    const svc = await import("./openingstock");
    const before = ledgerMg();
    const report = await svc.backfillIntakeLedger(db, "u1");
    expect(report.posted).toEqual([]);
    expect(ledgerMg()).toBe(before);
  });

  it("reports a product that already carries an OPENING intake row as skipped, not posted", async () => {
    // Give the sold piece a second day: the backfill runs again after someone
    // manually inserted one row. Only the remaining products are candidates.
    addDirectIntake("pr4", "Later piece", "BC-0004", 2000, 1832, 5000);
    const svc = await import("./openingstock");
    const report = await svc.backfillIntakeLedger(db, "u1");
    expect(report.posted.map((p) => p.productId)).toEqual(["pr4"]);
  });
});
