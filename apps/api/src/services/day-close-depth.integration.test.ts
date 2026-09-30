// End-to-end over real SQLite: finding a missing amount, a counted close that
// posts its difference, card-terminal comparison, reopen/re-close, and the
// reports built on closed days.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("day close depth over real SQLite", () => {
  let db: D1Database;
  let today: string;
  let closingId = "";

  const cash = async (branchId: string) => {
    const r = await db
      .prepare(
        "SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code = '1000' AND e.branch_id = ?"
      )
      .bind(branchId)
      .first<{ n: number }>();
    return r?.n ?? 0;
  };

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    m.raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','o@x','Owner','x',0,0), ('u2','m@x','Manager','x',0,0), ('u3','a@x','Auditor','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u3','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
    const { createCashEntry } = await import("./cashentries");
    await createCashEntry(db, { branchId: "b1", kind: "OWNER_CAPITAL", amountCents: 5_000_000, method: "cash", note: "Float" }, "u1");
    await createCashEntry(db, { branchId: "b1", kind: "OTHER_INCOME", amountCents: 200_000, method: "cash", note: "Polishing" }, "u1");
    await createCashEntry(db, { branchId: "b2", kind: "OWNER_CAPITAL", amountCents: 100_000, method: "cash", note: "Float" }, "u1");
    // A sale at b2 with no journal behind it: what a failing cross-foot is made of.
    m.raw.exec(`INSERT INTO sales_invoices (id, number, branch_id, subtotal_cents, discount_cents, total_cents, paid_cents, status, created_at)
                VALUES ('ghost','SINV-9999','b2',30000,0,30000,30000,'PAID',${Date.now()})`);
  });

  it("names the movement that is exactly the size of a shortage", async () => {
    const { investigateDay } = await import("./dayreports");
    const inv = await investigateDay(db, { branchId: "b1", date: today, actualCents: 5_000_000 });
    expect(inv.expectedCents).toBe(5_200_000);
    expect(inv.differenceCents).toBe(-200_000);
    expect(inv.failingChecks).toEqual([]);
    expect(inv.documentIssues).toEqual([]);
    expect(inv.cashMovements.map((m) => m.cents)).toEqual([5_000_000, 200_000]);
    expect(inv.suspects[0]).toMatchObject({ cents: 200_000 });
    expect(inv.suspects[0]!.explanation).toMatch(/inflow the size of the shortage/);
  });

  it("names the document behind a failing check", async () => {
    const { investigateDay } = await import("./dayreports");
    const inv = await investigateDay(db, { branchId: "b2", date: today });
    expect(inv.failingChecks.map((c) => c.id)).toContain("sales_crossfoot");
    // Both are true of the ghost: nothing posted, and no payment rows either.
    expect(inv.documentIssues).toEqual([
      expect.objectContaining({ kind: "sale", number: "SINV-9999", problem: "Sale has no journal entry", documentCents: 30000 }),
      expect.objectContaining({ kind: "sale", number: "SINV-9999", problem: "Payments recorded differ from the invoice total", ledgerCents: 0 }),
    ]);
  });

  it("refuses a note count that does not add up to the total", async () => {
    const { closeDay } = await import("./dayclose");
    await expect(
      closeDay(db, { branchId: "b1", date: today, actualCents: 5_000_000, differenceReason: "short", denominations: { "5000": 9 } }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      closeDay(db, { branchId: "b1", date: today, actualCents: 5_000_000, differenceReason: "short", denominations: { "3000": 1 } }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a card terminal difference needs an explanation", async () => {
    const { closeDay } = await import("./dayclose");
    await expect(
      closeDay(db, { branchId: "b1", date: today, actualCents: 5_200_000, cardTerminalCents: 500 }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("closes with the count and posts the shortage so the ledger drawer is the real drawer", async () => {
    const { closeDay, getClosing } = await import("./dayclose");
    const r = await closeDay(
      db,
      {
        branchId: "b1",
        date: today,
        actualCents: 5_000_000,
        differenceReason: "Polishing fee not collected",
        denominations: { "5000": 9, "1000": 5 },
        cardTerminalCents: 0,
        postDifference: true,
      },
      "u1"
    );
    closingId = r.id;
    expect(r.report.closing.differenceCents).toBe(-200_000);
    expect(await cash("b1")).toBe(5_000_000);
    const { closing } = await getClosing(db, closingId);
    expect(closing).toMatchObject({ correction_cents: -200_000, card_expected_cents: 0, card_actual_cents: 0 });
    expect(JSON.parse(closing.denominations_json!)).toEqual({ "5000": 9, "1000": 5 });
    const short = await db.prepare("SELECT COALESCE(SUM(debit_cents - credit_cents),0) AS n FROM journal_lines WHERE account_code = '6090'").first<{ n: number }>();
    expect(short?.n).toBe(200_000);
  });

  it("a re-close after reopening posts only the change, not the shortage again", async () => {
    const { closeDay, reopenDay, getClosing } = await import("./dayclose");
    await reopenDay(db, closingId, { reason: "Recount", approvedBy: "u3" }, "u2");
    const r = await closeDay(db, { branchId: "b1", date: today, actualCents: 5_000_000, postDifference: true }, "u2");
    expect(r.report.closing.differenceCents).toBe(0);
    expect(await cash("b1")).toBe(5_000_000);
    expect((await getClosing(db, closingId)).closing.correction_cents).toBe(-200_000);
  });

  it("the variance report shows the short day and who closed it", async () => {
    const { varianceReport } = await import("./dayreports");
    const { closeDay } = await import("./dayclose");
    await closeDay(db, { branchId: "b2", date: today, actualCents: 100_000 }, "u1").catch(() => null); // b2 cannot close: its check fails
    const v = await varianceReport(db, { from: today, to: today });
    expect(v.days).toBe(1);
    expect(v.rows[0]).toMatchObject({ branchId: "b1", differenceCents: 0 });
  });

  it("lists days with activity that nobody closed", async () => {
    const { listUnclosedDays } = await import("./dayreports");
    expect(await listUnclosedDays(db, { branchId: "b1", from: today, to: today })).toEqual([]);
    const b2 = await listUnclosedDays(db, { branchId: "b2", from: today, to: today });
    expect(b2).toEqual([{ date: today, status: "NOT_CLOSED", entries: 1, cashMovementCents: 100_000 }]);
  });

  it("summarises every branch for the day", async () => {
    const { dailySummary } = await import("./dayreports");
    const s = await dailySummary(db, today);
    const byId = new Map(s.branches.map((b) => [b.branchId, b]));
    expect(byId.get("b1")).toMatchObject({ status: "CLOSED", actualCents: 5_000_000, checksPassed: true });
    expect(byId.get("b2")).toMatchObject({ status: "OPEN", actualCents: null, checksPassed: false });
    expect(s.totals).toMatchObject({ closed: 1, open: 1 });
  });

  it("exports the report as CSV", async () => {
    const { closingReportCsv } = await import("./dayreports");
    const { getClosing } = await import("./dayclose");
    const { closing, report } = await getClosing(db, closingId);
    const csv = closingReportCsv(report, {
      branchName: "Main",
      status: "CLOSED",
      actualCents: closing.actual_cents,
      differenceCents: closing.difference_cents,
      reason: closing.difference_reason,
      denominations: { "5000": 10 },
    });
    expect(csv).toContain("Counted cash,50000.00");
    expect(csv).toContain("Cash count,5000 x 10,50000.00");
    expect(csv).toContain("Owner put money in,50000.00");
  });
});
