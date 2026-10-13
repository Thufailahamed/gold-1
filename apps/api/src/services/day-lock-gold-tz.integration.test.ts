// Gold movements respect the day lock, the close notices gold landing while
// it is computed, and every shop-local day boundary follows the timezone
// setting rather than a hardcoded +05:30.
import { beforeAll, describe, expect, it } from "vitest";
import { businessDate } from "@goldos/shared";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

const gold = (branchId: string, extra: Partial<{ source: string; destination: string; occurredAt: number }> = {}) => ({
  branchId,
  source: `branch:${branchId}`,
  destination: "loss",
  type: "ADJUSTMENT",
  weightMg: 1_000,
  permille: 916,
  refEntity: "test",
  refId: crypto.randomUUID(),
  ...extra,
});
const audit = { actorId: "u1", auditAction: "test.gold", auditEntity: "test", auditEntityId: "t" };

describe.skipIf(!sqliteAvailable)("gold day lock and shop timezone over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  let today: string;

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0), ('b3','Galle','GLE',0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
    const { createCashEntry } = await import("./cashentries");
    for (const b of ["b1", "b2", "b3"])
      await createCashEntry(db, { branchId: b, kind: "OWNER_CAPITAL", amountCents: 100_000, method: "cash", note: "Float" }, "u1");
    const { closeDay } = await import("./dayclose");
    await closeDay(db, { branchId: "b1", date: today, actualCents: 100_000 }, "u1");
  });

  it("refuses a gold movement at a branch whose day is closed", async () => {
    const { postGoldStmts } = await import("./gold");
    await expect(postGoldStmts(db, [gold("b1")], audit)).rejects.toMatchObject({ code: "TRANSITION_LOCKED", message: expect.stringContaining("Main") });
    // An open branch is unaffected.
    await db.batch(await postGoldStmts(db, [gold("b2")], audit));
  });

  it("refuses a transfer into a branch whose day is closed", async () => {
    const { postGoldStmts } = await import("./gold");
    await expect(
      postGoldStmts(db, [gold("b2", { source: "branch:b2", destination: "branch:b1" })], audit)
    ).rejects.toMatchObject({ code: "TRANSITION_LOCKED" });
  });

  it("aborts a raw gold insert on a closed day inside the write", async () => {
    await expect(
      db.batch([
        db
          .prepare(
            "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, created_at) VALUES ('raw', ?, 'b1', 'branch:b1', 'loss', 'LOSS', 1000, 916, 916, 'melting_batch', 'm1', ?)"
          )
          .bind(Date.now(), Date.now()),
      ])
    ).rejects.toThrow(/DAY_CLOSED/);
    // ...and on an earlier, open day the same row goes in.
    await db.batch([
      db
        .prepare(
          "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, created_at) VALUES ('raw2', ?, 'b1', 'branch:b1', 'loss', 'LOSS', 1000, 916, 916, 'melting_batch', 'm1', ?)"
        )
        .bind(Date.now() - 3 * 86_400_000, Date.now()),
    ]);
  });

  it("refuses to close when gold lands while the close is computed", async () => {
    const { closeDay } = await import("./dayclose");
    const { postGoldStmts } = await import("./gold");
    let injected = false;
    const racing = {
      ...db,
      prepare: db.prepare.bind(db),
      batch: async (stmts: D1PreparedStatement[]) => {
        if (!injected) {
          injected = true;
          await db.batch(await postGoldStmts(db, [gold("b3")], audit));
        }
        return db.batch(stmts);
      },
    } as D1Database;
    await expect(closeDay(racing, { branchId: "b3", date: today, actualCents: 100_000 }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.prepare("SELECT 1 AS x FROM day_closings WHERE branch_id = 'b3'").first()).toBeNull();
  });

  it("puts SQL day boundaries on the configured offset, matching the JS business date", async () => {
    const { LOCAL_DAY, businessDateFor } = await import("./busdate");
    // 2026-03-01 02:00 UTC: already 07:30 on the 1st in Colombo, still the
    // 28th of February 21:00 in New York.
    const t = Date.UTC(2026, 2, 1, 2, 0);
    const sqlDay = async () =>
      (await db.prepare(`SELECT ${LOCAL_DAY("x")} AS d FROM (SELECT ? AS x)`).bind(t).first<{ d: string }>())!.d;
    expect(await sqlDay()).toBe("2026-03-01");
    const seeded = raw.prepare("SELECT value_json FROM settings WHERE key = 'business_tz_offset_minutes'").get() as { value_json: string } | undefined;
    raw.exec(`INSERT OR REPLACE INTO settings (key, value_json, type) VALUES ('business_tz_offset_minutes', '-300', 'number')`);
    expect(await sqlDay()).toBe("2026-02-28");
    expect(await businessDateFor(db, t)).toBe("2026-02-28");
    expect(businessDate(t, -300)).toBe("2026-02-28");
    // The gold trigger reads the same setting: a close on the 28th (shop
    // time) locks a row stamped 02:00 UTC on the 1st.
    raw.exec(`INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents, difference_cents, report_json, checks_passed, status, closed_by, closed_at, created_at)
              VALUES ('tz1','b2','2026-02-28',0,0,0,0,0,0,'{}',1,'CLOSED','u1',1,1)`);
    await expect(
      db.batch([
        db
          .prepare(
            "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, created_at) VALUES ('tz', ?, 'b2', 'branch:b2', 'loss', 'LOSS', 1000, 916, 916, 'melting_batch', 'm2', ?)"
          )
          .bind(t, Date.now()),
      ])
    ).rejects.toThrow(/DAY_CLOSED/);
    if (seeded) raw.prepare("UPDATE settings SET value_json = ? WHERE key = 'business_tz_offset_minutes'").run(seeded.value_json);
    else raw.exec(`DELETE FROM settings WHERE key = 'business_tz_offset_minutes'`);
    expect(await sqlDay()).toBe("2026-03-01");
  });
});
