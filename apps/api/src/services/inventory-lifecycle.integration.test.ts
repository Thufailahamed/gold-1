// End-to-end over real SQLite: a stock count from snapshot to write-off, a
// branch transfer from request to receipt, and the branch scoping that keeps
// one branch's stock out of another's view.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("inventory lifecycle over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  const ids: Record<string, { id: string; barcode: string }> = {};
  let countId = "";

  const status = (id: string) => (raw.prepare("SELECT status, branch_id FROM products WHERE id = ?").get(id) as { status: string; branch_id: string });

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','i@x','Inventory','x',0,0), ('u2','o@x','Owner','x',0,0), ('u3','k@x','Kandy clerk','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u2','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1'), ('u3','b2');
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r1','purity-22k', 2500000, 1, 1);
    `);
    const { createProduct } = await import("./products");
    const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", stoneG: 0, makingLkr: 0, wastageG: 0, grossG: 5 };
    for (const [key, branchId, costLkr] of [["a", "b1", 1000], ["b", "b1", 2000], ["c", "b1", undefined], ["k", "b2", 500]] as const) {
      const p = await createProduct(db, { ...base, name: `Ring ${key}`, branchId, ...(costLkr !== undefined ? { costLkr } : {}) }, "u1");
      ids[key] = { id: p.id, barcode: p.barcode };
    }
  });

  it("opens a count over the branch's shelf and refuses a second on the same scope", async () => {
    const { startCount } = await import("./counts");
    const r = await startCount(db, { branchId: "b1", scope: "FULL" }, "u1");
    countId = r.id;
    expect(r.expectedCount).toBe(3);
    await expect(startCount(db, { branchId: "b1", scope: "FULL" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("flags scans against the snapshot, not merely against the catalog", async () => {
    const { recordScan } = await import("./counts");
    expect((await recordScan(db, countId, ids.a!.barcode.toLowerCase() + "\r\n", "u1")).flag).toBe("OK");
    expect((await recordScan(db, countId, ids.a!.barcode, "u1")).flag).toBe("DUPLICATE");
    // A real piece that belongs to another branch is on the wrong shelf.
    expect((await recordScan(db, countId, ids.k!.barcode, "u1")).flag).toBe("UNEXPECTED");
    expect((await recordScan(db, countId, "JW-NOSUCH", "u1")).flag).toBe("UNEXPECTED");
  });

  it("locks counted pieces against void as well as sale and transfer", async () => {
    const { voidProduct } = await import("./products");
    await expect(voidProduct(db, ids.a!.id, "u1", "damaged")).rejects.toMatchObject({ code: "TRANSITION_LOCKED" });
  });

  it("keeps investigation notes through the count", async () => {
    const { addNote, getCount } = await import("./counts");
    await addNote(db, countId, ids.b!.id, "Checked the safe", "u1");
    const d = await getCount(db, countId);
    expect(d.summary).toMatchObject({ expected: 3, matched: 1, missing: 2, unexpected: 2, duplicates: 1 });
    expect(d.lines.find((l) => l.productId === ids.b!.id)).toMatchObject({ state: "MISSING", note: "Checked the safe" });
  });

  it("posts nothing at all when one missing line cannot be valued", async () => {
    const { approveCount } = await import("./counts");
    await expect(approveCount(db, countId, { reason: "Shortage", approvedBy: "u2" }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(status(ids.b!.id).status).toBe("IN_STOCK");
    expect(status(ids.c!.id).status).toBe("IN_STOCK");
    const count = raw.prepare("SELECT status FROM stock_counts WHERE id = ?").get(countId) as { status: string };
    expect(count.status).toBe("OPEN");
  });

  it("writes the whole shortage off in one go once every line is costed", async () => {
    const { approveCount, getCount } = await import("./counts");
    const { missingReport } = await import("./discrepancies");
    // An explicit zero cost is a piece carried at nothing: metal leaves, no value does.
    raw.exec(`UPDATE products SET cost_cents = 0 WHERE id = '${ids.c!.id}'`);
    const r = await approveCount(db, countId, { reason: "Shortage", approvedBy: "u2" }, "u1");
    expect(r.posted).toBe(2);
    expect(status(ids.b!.id).status).toBe("LOST");
    expect(status(ids.c!.id).status).toBe("LOST");
    const w = raw.prepare("SELECT COALESCE(SUM(debit_cents - credit_cents),0) AS n FROM journal_lines WHERE account_code = '5300'").get() as { n: number };
    expect(w.n).toBe(200_000);
    const moves = raw.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'LOSS'").get() as { n: number };
    expect(moves.n).toBe(2);
    const d = await getCount(db, countId);
    expect(d.count.status).toBe("COMPLETE");
    expect(d.lines.find((l) => l.productId === ids.b!.id)).toMatchObject({ posted: true, note: "Checked the safe" });
    const rep = await missingReport(db, "b1");
    expect(rep.rows.filter((x) => x.posted).map((x) => x.productId).sort()).toEqual([ids.b!.id, ids.c!.id].sort());
  });

  it("refuses to cancel a count that is already closed", async () => {
    const { cancelCount } = await import("./counts");
    await expect(cancelCount(db, countId, "oops", "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  let transferId = "";
  it("will not put one piece on two open transfers", async () => {
    const { requestTransfer } = await import("./transfers");
    const t = await requestTransfer(db, { fromBranchId: "b1", toBranchId: "b2", productIds: [ids.a!.id] }, "u1");
    transferId = t.id;
    expect(t.number).toBe("TRF-000001");
    await expect(requestTransfer(db, { fromBranchId: "b1", toBranchId: "b2", productIds: [ids.a!.id] }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("moves a piece request → approve → dispatch → receive with the gold following it", async () => {
    const { approveTransfer, dispatchTransfer, receiveLines, reconcileTransfer, getTransferDetail } = await import("./transfers");
    await expect(approveTransfer(db, transferId, "u1", "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await approveTransfer(db, transferId, "u2", "u2");
    await dispatchTransfer(db, transferId, "u1");
    expect(status(ids.a!.id)).toEqual({ status: "TRANSFER_PENDING", branch_id: "b1" });
    const r = await receiveLines(db, transferId, [ids.a!.barcode.toLowerCase()], "u3");
    expect(r.received).toEqual([ids.a!.barcode]);
    expect(status(ids.a!.id)).toEqual({ status: "IN_STOCK", branch_id: "b2" });
    expect(await reconcileTransfer(db, transferId)).toEqual({ passed: true, warnings: [] });
    const d = await getTransferDetail(db, transferId);
    expect(d).toMatchObject({ status: "COMPLETE", fromBranchName: "Main", toBranchName: "Kandy", approvedByName: "Owner" });
    expect(d.lines[0]).toMatchObject({ name: "Ring a", status: "RECEIVED" });
  });

  it("records a restock of a returned piece as RESTOCK, not a transfer", async () => {
    const { recordMovement } = await import("./inventory");
    raw.exec(`UPDATE products SET status = 'RETURNED' WHERE id = '${ids.k!.id}'`);
    await recordMovement(db, { productId: ids.k!.id, toStatus: "IN_STOCK", reason: "back on shelf" }, "u3");
    const m = raw.prepare("SELECT type FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(ids.k!.id) as { type: string };
    expect(m.type).toBe("RESTOCK");
  });

  it("scopes stock, insights, counts and transfers to the caller's branches", async () => {
    const { stockSummary, inventoryInsights } = await import("./inventory");
    const { listCounts } = await import("./counts");
    const { listTransfers } = await import("./transfers");
    const { branchScope } = await import("./branchAccess");
    const scope = await branchScope(db, "u3", []);
    expect(scope).toEqual(["b2"]);
    const stock = await stockSummary(db, "branch", scope);
    expect(stock.map((r) => r.key)).toEqual(["b2"]);
    expect(stock[0]).toMatchObject({ name: "Kandy", pieces: 2 });
    const ins = await inventoryInsights(db, scope);
    expect(ins.totals.pieces).toBe(2);
    expect(await listCounts(db, { branchIds: scope! })).toEqual([]);
    expect((await listTransfers(db, { scope })).map((t) => t.number)).toEqual(["TRF-000001"]);
    expect(await listTransfers(db, { scope: [] })).toEqual([]);
    expect(await branchScope(db, "u3", ["branches:manage"])).toBeNull();
  });
});
