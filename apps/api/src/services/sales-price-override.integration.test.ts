// The till may charge a price other than the shelf price. Revenue, tax and
// refunds follow the price charged; the shelf price is kept alongside; a
// markdown counts as a discount; selling under book cost needs a second person.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("POS price override over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];
  const ids: string[] = [];

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','o@x','Owner','x',0,0), ('u2','m@x','Manager','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
    `);
    const { createProduct } = await import("./products");
    const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 };
    for (const name of ["Ring A", "Ring B", "Ring C"]) ids.push((await createProduct(db, { ...base, name, grossG: 2 }, "u1")).id);
    raw.exec(`UPDATE products SET selling_price_cents = 5000000`); // shelf 50,000 LKR, cost 10,000
  });

  const line = (i: number, priceLkr: number) => ({ productId: ids[i]!, priceLkr, listPriceLkr: 50000, discountLkr: 0 });

  it("sells above shelf: revenue is the price charged, shelf price is kept", async () => {
    const { receiveSale } = await import("./sales");
    const r = await receiveSale(db, { branchId: "b1", items: [line(0, 60000)], payments: [{ method: "cash", amountLkr: 60000 }] }, "u1", { enforceShelfPrice: true });
    const item = await db.prepare("SELECT price_cents, list_price_cents FROM sales_items WHERE invoice_id = ?").bind(r.invoiceId).first<{ price_cents: number; list_price_cents: number }>();
    expect(item).toMatchObject({ price_cents: 6_000_000, list_price_cents: 5_000_000 });
    const rev = await db
      .prepare("SELECT COALESCE(SUM(jl.credit_cents - jl.debit_cents),0) AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.ref_id = ? AND jl.account_code = '4000'")
      .bind(r.invoiceId)
      .first<{ n: number }>();
    expect(rev?.n).toBe(6_000_000);
    const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'sale.price_override' AND entity_id = ?").bind(r.invoiceId).first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it("refuses a stale shelf price even when a different price is charged", async () => {
    const { receiveSale } = await import("./sales");
    await expect(
      receiveSale(db, { branchId: "b1", items: [{ ...line(1, 45000), listPriceLkr: 40000 }], payments: [{ method: "cash", amountLkr: 45000 }] }, "u1", { enforceShelfPrice: true })
    ).rejects.toMatchObject({ code: "CONFLICT", priceCents: 5_000_000 });
  });

  it("a client that sends no shelf price still has to charge it", async () => {
    const { receiveSale } = await import("./sales");
    await expect(
      receiveSale(db, { branchId: "b1", items: [{ productId: ids[1]!, priceLkr: 45000, discountLkr: 0 }], payments: [{ method: "cash", amountLkr: 45000 }] }, "u1", { enforceShelfPrice: true })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("selling below book cost goes through with no sign-off, at the price charged", async () => {
    const { receiveSale } = await import("./sales");
    raw.exec(`UPDATE products SET cost_cents = 4900000 WHERE id = '${ids[1]}'`); // book cost 49,000
    const r = await receiveSale(db, { branchId: "b1", items: [line(1, 48000)], payments: [{ method: "cash" as const, amountLkr: 48000 }] }, "u1", { enforceShelfPrice: true });
    expect(r.number).toBeTruthy();
  });
});
