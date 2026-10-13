// The day lock under concurrency, over real SQLite: a posting that passed the
// service-level check before the close committed, a posting that lands while
// the close is being computed, and the survey refusing what the close would.
import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { addDays } from "@goldos/shared";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("day lock races over real SQLite", () => {
  let db: D1Database;
  let today: string;

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    m.raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0), ('b3','Galle','GLE',0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
    const { createCashEntry } = await import("./cashentries");
    for (const b of ["b1", "b2", "b3"])
      await createCashEntry(db, { branchId: b, kind: "OWNER_CAPITAL", amountCents: 100_000, method: "cash", note: "Float" }, "u1");
  });

  it("rejects a posting built before the close but committed after it", async () => {
    const { buildEntryStmts } = await import("./journal");
    const { closeDay } = await import("./dayclose");
    // Passes the service-level lock check: the day is still open here.
    const late = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "1000", debitCents: 5_000, creditCents: 0 },
          { account: "3000", debitCents: 0, creditCents: 5_000 },
        ],
        refEntity: "owner_capital",
        refId: "late",
        memo: "Raced the close",
        branchId: "b1",
        actorId: "u1",
        auditAction: "test.late",
        auditEntity: "test",
        auditEntityId: "late",
        sourceModule: "cash",
      },
      { entryDate: today }
    );
    await closeDay(db, { branchId: "b1", date: today, actualCents: 100_000 }, "u1");
    await expect(db.batch(late.stmts)).rejects.toThrow(/DAY_CLOSED/);
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE ref_id = 'late'")
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("refuses to close when a posting lands while the close is computed", async () => {
    const { closeDay } = await import("./dayclose");
    const { createCashEntry } = await import("./cashentries");
    let injected = false;
    // The close's own batch is the first one through this handle; a posting
    // commits just before it, after the report was frozen.
    const racing = {
      ...db,
      prepare: db.prepare.bind(db),
      batch: async (stmts: D1PreparedStatement[]) => {
        if (!injected) {
          injected = true;
          await createCashEntry(db, { branchId: "b2", kind: "OTHER_INCOME", amountCents: 7_000, method: "cash", note: "Mid-close" }, "u1");
        }
        return db.batch(stmts);
      },
    } as D1Database;
    await expect(closeDay(racing, { branchId: "b2", date: today, actualCents: 100_000 }, "u1")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const row = await db.prepare("SELECT 1 AS x FROM day_closings WHERE branch_id = 'b2'").first();
    expect(row).toBeNull();
    // Recounted and closed again, it freezes the figures that include the posting.
    const { report } = await closeDay(db, { branchId: "b2", date: today, actualCents: 107_000 }, "u1");
    expect(report.closing.expectedCents).toBe(107_000);
  });

  it("re-closes a reopened day with the same guard", async () => {
    const { closeDay, reopenDay } = await import("./dayclose");
    const { id } = await closeDay(db, { branchId: "b3", date: today, actualCents: 100_000 }, "u1");
    await reopenDay(db, id, { reason: "Recount" }, "u1");
    const { report } = await closeDay(db, { branchId: "b3", date: today, actualCents: 100_000 }, "u1");
    expect(report.closing.differenceCents).toBe(0);
  });

  it("blocks a future day in the survey, so auto close explains instead of erroring", async () => {
    const { autoCloseDay } = await import("./daysurvey");
    const tomorrow = addDays(today, 1);
    const res = await autoCloseDay(db, { branchId: "b1", date: tomorrow, actualCents: 0 }, "u1");
    expect(res.closed).toBe(false);
    expect(res.survey.verdict).toBe("BLOCKED");
    expect(res.survey.findings.map((f) => f.title)).toContain("This day has not started yet");
  });

  it("answers a lost race as 409, not a 500", async () => {
    const { errorHandler } = await import("../middleware/error");
    const app = new Hono()
      .get("/", () => {
        throw new Error("D1_ERROR: DAY_CLOSED: the day is closed at this branch: SQLITE_CONSTRAINT");
      })
      .onError(errorHandler);
    const res = await app.request("/");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "TRANSITION_LOCKED" } });
  });
});
