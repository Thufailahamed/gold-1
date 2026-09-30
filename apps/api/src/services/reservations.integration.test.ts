// A piece held for a customer, over real SQLite: the hold keeps it on hand
// (stock, counts), only that customer can buy it, and every way out of the
// hold — release or sale — clears it.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("reservations over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];
  const ids: { id: string; barcode: string }[] = [];

  const row = (id: string) =>
    raw
      .prepare("SELECT status, reserved_customer_id, reserved_note, reserved_until, reserved_by FROM products WHERE id = ?")
      .get(id) as { status: string; reserved_customer_id: string | null; reserved_note: string | null; reserved_until: number | null; reserved_by: string | null };

  const sale = (productId: string, customerId?: string) => ({
    branchId: "b1",
    customerId,
    items: [{ productId, priceLkr: 50000, discountLkr: 0 }],
    payments: [{ method: "cash" as const, amountLkr: 50000 }],
  });

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1');
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0), ('c2','Kamala','0772222222','b1',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r1','purity-22k', 2500000, 1, 1);
    `);
    const { createProduct } = await import("./products");
    const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000, grossG: 2 };
    for (const name of ["Ring A", "Ring B"]) {
      const p = await createProduct(db, { ...base, name }, "u1");
      ids.push({ id: p.id, barcode: p.barcode });
    }
    raw.exec(`UPDATE products SET selling_price_cents = 5000000`);
  });

  it("holds a piece for a customer and shows who it is for on the tag lookup", async () => {
    const { reserveProduct } = await import("./inventory");
    const { findByBarcode } = await import("./products");
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const r = await reserveProduct(db, ids[0]!.id, { customerId: "c1", note: "Wedding on Friday", untilDate: tomorrow }, "u1");
    expect(r.reservedUntil).toBeGreaterThan(Date.now());
    expect(row(ids[0]!.id)).toMatchObject({ status: "RESERVED", reserved_customer_id: "c1", reserved_note: "Wedding on Friday", reserved_by: "u1" });
    const d = await findByBarcode(db, ids[0]!.barcode);
    expect(d.product).toMatchObject({ status: "RESERVED", reserved_customer_name: "Nimal" });
    const mv = raw.prepare("SELECT type, from_status, to_status FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(ids[0]!.id);
    expect(mv).toMatchObject({ type: "RESERVE", from_status: "IN_STOCK", to_status: "RESERVED" });
  });

  it("refuses bad holds: past date, unknown customer, a piece already held", async () => {
    const { reserveProduct } = await import("./inventory");
    await expect(reserveProduct(db, ids[1]!.id, { customerId: "c1", note: "x", untilDate: "2000-01-01" }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(reserveProduct(db, ids[1]!.id, { customerId: "nobody", note: "x" }, "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reserveProduct(db, ids[0]!.id, { customerId: "c2", note: "x" }, "u1")).rejects.toMatchObject({ code: "TRANSITION_LOCKED" });
    expect(row(ids[1]!.id).status).toBe("IN_STOCK");
  });

  it("keeps a held piece in stock, in counts, and out of generic movements and void", async () => {
    const { stockSummary, recordMovement } = await import("./inventory");
    const { voidProduct } = await import("./products");
    const { startCount, cancelCount } = await import("./counts");
    const { heldGoldStages } = await import("./reconcile");
    const stock = await stockSummary(db, "branch");
    expect(stock[0]).toMatchObject({ key: "b1", pieces: 2 });
    const held = await heldGoldStages(db, "b1");
    expect(held.products).toBeGreaterThan(0);
    const count = await startCount(db, { branchId: "b1", scope: "FULL" }, "u1");
    expect(count.expectedCount).toBe(2);
    await cancelCount(db, count.id, "test", "u1");
    await expect(recordMovement(db, { productId: ids[0]!.id, toStatus: "IN_STOCK" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(recordMovement(db, { productId: ids[1]!.id, toStatus: "RESERVED" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(voidProduct(db, ids[0]!.id, "u1", "damaged")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(row(ids[0]!.id).status).toBe("RESERVED");
  });

  it("sells a held piece only to the customer it is held for, and the sale ends the hold", async () => {
    const { receiveSale } = await import("./sales");
    await expect(receiveSale(db, sale(ids[0]!.id), "u1", { enforceShelfPrice: true })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(receiveSale(db, sale(ids[0]!.id, "c2"), "u1", { enforceShelfPrice: true })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(row(ids[0]!.id).status).toBe("RESERVED");
    await receiveSale(db, sale(ids[0]!.id, "c1"), "u1", { enforceShelfPrice: true });
    expect(row(ids[0]!.id)).toMatchObject({ status: "SOLD", reserved_customer_id: null, reserved_note: null, reserved_until: null, reserved_by: null });
    const mv = raw.prepare("SELECT type, from_status FROM stock_movements WHERE product_id = ? AND type = 'SALE_OUT'").get(ids[0]!.id);
    expect(mv).toMatchObject({ from_status: "RESERVED" });
  });

  it("releases a hold back to the shelf for anyone", async () => {
    const { reserveProduct, releaseReservation } = await import("./inventory");
    const { receiveSale } = await import("./sales");
    await reserveProduct(db, ids[1]!.id, { customerId: "c1", note: "Thinking about it" }, "u1");
    expect(row(ids[1]!.id).reserved_until).toBeNull();
    await releaseReservation(db, ids[1]!.id, "Customer changed their mind", "u1");
    expect(row(ids[1]!.id)).toMatchObject({ status: "IN_STOCK", reserved_customer_id: null, reserved_note: null });
    const mv = raw.prepare("SELECT type, reason FROM stock_movements WHERE product_id = ? AND type = 'RELEASE'").get(ids[1]!.id);
    expect(mv).toMatchObject({ reason: "Customer changed their mind" });
    await expect(releaseReservation(db, ids[1]!.id, undefined, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    await receiveSale(db, sale(ids[1]!.id, "c2"), "u1", { enforceShelfPrice: true });
    expect(row(ids[1]!.id).status).toBe("SOLD");
  });
});
