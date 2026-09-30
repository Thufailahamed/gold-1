// Gold on the road, over real SQLite. The ledger moves a dispatched piece to
// the receiver at once; per-branch stock must agree with it while the piece
// is in transit, after it is received, and after it is recalled.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("in-transit gold over real SQLite", () => {
  let db: D1Database;
  const ids: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const goldCheck = async (branchId?: string) => {
    const { reconcile } = await import("./reconcile");
    const r = await reconcile(db, { date: today, branchId });
    return r.checks.find((c) => c.id === "gold_stock_consistency")!;
  };
  const expectConsistent = async () => {
    for (const b of ["b1", "b2", undefined]) {
      const c = await goldCheck(b);
      expect({ branch: b ?? "shop", difference: c.difference }).toEqual({ branch: b ?? "shop", difference: 0 });
    }
  };
  const ship = async (productId: string) => {
    const t = await import("./transfers");
    const { id } = await t.requestTransfer(db, { fromBranchId: "b1", toBranchId: "b2", productIds: [productId] }, "u1");
    await t.approveTransfer(db, id, "u2", "u1");
    await t.dispatchTransfer(db, id, "u1");
    return id;
  };

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    m.raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','i@x','Clerk','x',0,0), ('u2','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u2','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1'), ('u2','b2');
    `);
    const { createProduct } = await import("./products");
    for (const name of ["Chain A", "Chain B"]) {
      const p = await createProduct(db, { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, grossG: 8, costLkr: 1000, name }, "u1");
      ids.push(p.id);
    }
  });

  it("starts consistent in every branch", expectConsistent);

  it("stays consistent in both branches while a piece is on the road", async () => {
    await ship(ids[0]!);
    await expectConsistent();
  });

  it("stays consistent after a recall, and the transfer reconciles", async () => {
    const t = await import("./transfers");
    const id = await ship(ids[1]!);
    await t.recallLines(db, id, [ids[1]!], "u1");
    await expectConsistent();
    expect(await t.reconcileTransfer(db, id)).toEqual({ passed: true, warnings: [] });
  });
});
