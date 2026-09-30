// The counter path over real SQLite: the till charges the shelf price, a tag
// cannot be sold twice in one bill, a scan finds a piece's sale, and an
// exchange ties its return to the replacement sale.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("POS sale flow over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];
  const ids: { id: string; barcode: string; sku: string }[] = [];
  let saleId = "";
  let saleNumber = "";

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','o@x','Owner','x',0,0), ('u2','m@x','Manager','x',0,0), ('u3','c@x','Cashier','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','owner'), ('u3','salesperson');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
    `);
    const { createProduct } = await import("./products");
    const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 };
    for (const name of ["Ring A", "Ring B", "Ring C"]) {
      const p = await createProduct(db, { ...base, name, grossG: 2 }, "u1");
      ids.push({ id: p.id, barcode: p.barcode, sku: p.sku });
    }
    // Shelf prices via the override so the test does not depend on rates.
    raw.exec(`UPDATE products SET selling_price_cents = 5000000`);
  });

  it("refuses a POS price that is not the shelf price", async () => {
    const { receiveSale } = await import("./sales");
    const input = {
      branchId: "b1",
      items: [{ productId: ids[0]!.id, priceLkr: 1000, discountLkr: 0 }],
      payments: [{ method: "cash" as const, amountLkr: 1000 }],
    };
    await expect(receiveSale(db, input, "u1", { enforceShelfPrice: true })).rejects.toMatchObject({
      code: "CONFLICT",
      priceCents: 5_000_000,
    });
    const status = await db.prepare("SELECT status FROM products WHERE id = ?").bind(ids[0]!.id).first<{ status: string }>();
    expect(status?.status).toBe("IN_STOCK");
  });

  it("refuses the same piece twice in one sale", async () => {
    const { receiveSale } = await import("./sales");
    const line = { productId: ids[0]!.id, priceLkr: 50000, discountLkr: 0 };
    await expect(
      receiveSale(db, { branchId: "b1", items: [line, line], payments: [{ method: "cash", amountLkr: 100000 }] }, "u1", { enforceShelfPrice: true })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("sells at the shelf price", async () => {
    const { receiveSale } = await import("./sales");
    const sale = await receiveSale(
      db,
      {
        branchId: "b1",
        customerId: "c1",
        items: [
          { productId: ids[0]!.id, priceLkr: 50000, discountLkr: 0 },
          { productId: ids[1]!.id, priceLkr: 50000, discountLkr: 0 },
        ],
        payments: [{ method: "cash", amountLkr: 100000 }],
      },
      "u1",
      { enforceShelfPrice: true }
    );
    saleId = sale.invoiceId;
    saleNumber = sale.number;
    expect(saleNumber).toMatch(/^SINV-\d{4}$/);
  });

  it("finds the sale from its invoice number, a tag or a SKU, as scanned", async () => {
    const { lookupSale } = await import("./sales");
    expect(await lookupSale(db, ` ${saleNumber.toLowerCase()}\r\n`)).toMatchObject({ invoiceId: saleId, productId: null });
    expect(await lookupSale(db, ids[1]!.barcode.toLowerCase())).toMatchObject({ invoiceId: saleId, productId: ids[1]!.id });
    expect(await lookupSale(db, ids[0]!.sku)).toMatchObject({ invoiceId: saleId });
    await expect(lookupSale(db, ids[2]!.barcode)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupSale(db, "SINV-9999")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an exchange return links to its replacement sale, once", async () => {
    const { createReturn, getSale, receiveSale } = await import("./sales");
    const before = await getSale(db, saleId);
    const itemA = (before.items as { id: string; product_id: string }[]).find((i) => i.product_id === ids[0]!.id)!.id;
    const ret = await createReturn(
      db,
      { invoiceId: saleId, itemIds: [itemA], type: "EXCHANGE", reason: "Size", refundMethod: "credit" },
      "u1"
    );
    const after = await getSale(db, saleId);
    expect(after.returnedItemIds).toEqual([itemA]);

    const exchangeInput = {
      branchId: "b1",
      customerId: "c1",
      items: [{ productId: ids[2]!.id, priceLkr: 50000, discountLkr: 0 }],
      // Store credit from the return settles the replacement.
      payments: [{ method: "credit" as const, amountLkr: 50000 }],
      exchangeReturnId: ret.returnId,
    };
    await expect(
      receiveSale(db, { ...exchangeInput, customerId: undefined, payments: [{ method: "cash", amountLkr: 50000 }] }, "u1", { enforceShelfPrice: true })
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const repl = await receiveSale(db, exchangeInput, "u1", { enforceShelfPrice: true });
    const link = await db.prepare("SELECT exchange_sale_id FROM sales_returns WHERE id = ?").bind(ret.returnId).first<{ exchange_sale_id: string }>();
    expect(link?.exchange_sale_id).toBe(repl.invoiceId);
    expect((await getSale(db, repl.invoiceId)).exchangeOf).toMatchObject({ id: ret.returnId, invoice_id: saleId });

    // Customer 1200: +50,000 credit from the return, −50,000 spent: nets to zero.
    const ar = await db
      .prepare("SELECT COALESCE(SUM(debit_cents - credit_cents), 0) AS n FROM journal_lines WHERE account_code = '1200' AND party_id = 'c1'")
      .first<{ n: number }>();
    expect(ar?.n).toBe(0);
  });

  it("lists counter approvers by name, never the cashier asking", async () => {
    const { listApprovers } = await import("./sales");
    const rows = await listApprovers(db, "u1");
    expect(rows.map((r) => r.id)).toContain("u2");
    expect(rows.map((r) => r.id)).not.toContain("u1");
    expect(rows.map((r) => r.id)).not.toContain("u3");
  });
});
