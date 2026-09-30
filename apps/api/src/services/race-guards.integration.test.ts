// Concurrency guards over real SQLite. Two calls started together both read
// the row before either batch commits — exactly the window that let a repair
// be collected (and its revenue posted) twice.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("race guards over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  const n = (sql: string, ...v: unknown[]) => (raw.prepare(sql).get(...v) as { n: number }).n;

  beforeAll(() => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0), ('u2','t@x','Tech','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1');
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
    `);
  });

  it("staleGuard rolls back the whole batch when the guarded update matched nothing", async () => {
    const { batchOrConflict, staleGuard } = await import("./guard");
    const before = n("SELECT COUNT(*) AS n FROM audit_logs");
    await expect(
      batchOrConflict(db, [
        db.prepare("UPDATE repairs SET status = 'READY' WHERE id = 'nope'"),
        staleGuard(db),
        db.prepare("INSERT INTO audit_logs (id, action, entity, entity_id, created_at) VALUES ('a-guard', 'x', 'x', 'x', 0)"),
      ], "lost the race")
    ).rejects.toMatchObject({ code: "CONFLICT", message: "lost the race" });
    expect(n("SELECT COUNT(*) AS n FROM audit_logs")).toBe(before);
  });

  it("collects a repair once when two tills submit at the same moment", async () => {
    const r = await import("./repairs");
    const { id } = await r.createRepair(db, { customerId: "c1", branchId: "b1", itemDesc: "Chain", weightG: 5, conditionIn: "broken clasp", repairType: "solder", estimateLkr: 1500 }, "u1");
    await r.assignRepair(db, id, "u2", "u1");
    await r.finishRepair(db, id, "u1");
    await r.qcRepair(db, id, true, undefined, "u1");
    const input = { payments: [{ method: "cash" as const, amountLkr: 1500 }], conditionOut: "fixed" };
    const results = await Promise.allSettled([r.collectRepair(db, id, input, "u1"), r.collectRepair(db, id, input, "u1")]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.find((x) => x.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(n("SELECT COUNT(*) AS n FROM journal_entries WHERE ref_entity = 'repair' AND ref_id = ?", id)).toBe(1);
    expect(n("SELECT COUNT(*) AS n FROM repair_events WHERE repair_id = ? AND to_status = 'COLLECTED'", id)).toBe(1);
  });

  it("allocates distinct numbers to simultaneous intakes", async () => {
    const r = await import("./repairs");
    const job = { customerId: "c1", branchId: "b1", itemDesc: "Ring", weightG: 3, conditionIn: "bent", repairType: "reshape", estimateLkr: 800 };
    const made = await Promise.all([r.createRepair(db, job, "u1"), r.createRepair(db, job, "u1"), r.createRepair(db, job, "u1")]);
    expect(new Set(made.map((m) => m.number)).size).toBe(3);
  });

  it("keeps both of two simultaneous custom-order advances", async () => {
    const co = await import("./customOrders");
    const { id } = await co.createCustomOrder(db, { customerId: "c1", branchId: "b1", design: "Bangle", goldReqG: 10, goldSource: "SHOP", quoteLkr: 100000 }, "u1");
    const results = await Promise.allSettled([
      co.advanceOrder(db, id, { amountLkr: 10000, method: "cash" }, "u1"),
      co.advanceOrder(db, id, { amountLkr: 20000, method: "cash" }, "u1"),
    ]);
    const posted = n("SELECT COUNT(*) AS n FROM journal_entries WHERE ref_entity = 'custom_advance' AND ref_id = ?", id);
    const { advance_cents } = raw.prepare("SELECT advance_cents FROM custom_orders WHERE id = ?").get(id) as { advance_cents: number };
    // Whatever interleaving happened, the books and the order agree.
    const sum = (raw.prepare("SELECT COALESCE(SUM(l.debit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.ref_entity = 'custom_advance' AND e.ref_id = ? AND l.debit_cents > 0").get(id) as { n: number }).n;
    expect(advance_cents).toBe(sum);
    expect(posted).toBe(results.filter((x) => x.status === "fulfilled").length);
  });

  it("refuses to earmark one old-gold item to two live orders, and releases it on cancel", async () => {
    const co = await import("./customOrders");
    raw.exec(`INSERT INTO old_gold_items (id, number, customer_id, branch_id, item_type, description, gross_mg, stone_mg, net_mg, fine_mg, status, staff_id, created_at, created_by)
              VALUES ('og1','OG-T1','c1','b1','ring','old ring',5000,0,5000,4580,'PURCHASED','u1',0,'u1')`);
    const order = { customerId: "c1", branchId: "b1", design: "Ring", goldReqG: 4, goldSource: "CUSTOMER" as const, quoteLkr: 50000 };
    const a = await co.createCustomOrder(db, order, "u1");
    const b = await co.createCustomOrder(db, order, "u1");
    await co.sourceGold(db, a.id, "CUSTOMER_OLDGOLD", "og1", "u1");
    await expect(co.sourceGold(db, b.id, "CUSTOMER_OLDGOLD", "og1", "u1")).rejects.toMatchObject({ code: "CONFLICT", message: `Already earmarked for ${a.number}` });
    await co.cancelCustomOrder(db, a.id, { reason: "customer changed mind" }, "u1");
    await expect(co.sourceGold(db, b.id, "CUSTOMER_OLDGOLD", "og1", "u1")).resolves.toBeUndefined();
  });
});
