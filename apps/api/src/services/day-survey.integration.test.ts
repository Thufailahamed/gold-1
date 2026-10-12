// End-to-end over real SQLite: the auto-close survey, its refusal with every
// reason at once, a clean auto-close, and the CSV/PDF it downloads as.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("day-close survey and auto close over real SQLite", () => {
  let db: D1Database;
  let today: string;

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    m.raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
    const { createCashEntry } = await import("./cashentries");
    await createCashEntry(db, { branchId: "b1", kind: "OWNER_CAPITAL", amountCents: 5_000_000, method: "cash", note: "Float" }, "u1");
    await createCashEntry(db, { branchId: "b1", kind: "OTHER_INCOME", amountCents: 200_000, method: "cash", note: "Polishing" }, "u1");
    await createCashEntry(db, { branchId: "b2", kind: "OWNER_CAPITAL", amountCents: 100_000, method: "cash", note: "Float" }, "u1");
    m.raw.exec(`INSERT INTO sales_invoices (id, number, branch_id, subtotal_cents, discount_cents, total_cents, paid_cents, status, created_at)
                VALUES ('ghost','SINV-9999','b2',30000,0,30000,30000,'PAID',${Date.now()})`);
  });

  it("blocks an uncounted drawer and says so", async () => {
    const { surveyDay } = await import("./daysurvey");
    const s = await surveyDay(db, { branchId: "b1", date: today });
    expect(s.verdict).toBe("BLOCKED");
    expect(s.cash.expectedCents).toBe(5_200_000);
    expect(s.findings[0]).toMatchObject({ severity: "blocker", title: "Drawer not counted" });
  });

  it("lists every failing check and the document behind it", async () => {
    const { autoCloseDay } = await import("./daysurvey");
    const r = await autoCloseDay(db, { branchId: "b2", date: today, actualCents: 100_000 }, "u1");
    expect(r.closed).toBe(false);
    expect(r.survey.verdict).toBe("BLOCKED");
    const blockers = r.survey.findings.filter((f) => f.severity === "blocker").map((f) => f.area);
    expect(blockers).toContain("Reconciliation");
    expect(r.survey.findings.some((f) => f.title.startsWith("SINV-9999"))).toBe(true);
  });

  it("wants an explanation for a short drawer before it closes", async () => {
    const { surveyDay } = await import("./daysurvey");
    const s = await surveyDay(db, { branchId: "b1", date: today, actualCents: 5_000_000 });
    expect(s.cash.differenceCents).toBe(-200_000);
    expect(s.findings.map((f) => f.title)).toContain("Cash difference not explained");
    const explained = await surveyDay(db, { branchId: "b1", date: today, actualCents: 5_000_000, differenceReason: "Polishing cash in safe" });
    expect(explained.verdict).toBe("READY");
  });

  it("closes a clean day and reports it as closed", async () => {
    const { autoCloseDay } = await import("./daysurvey");
    const r = await autoCloseDay(db, { branchId: "b1", date: today, actualCents: 5_200_000 }, "u1");
    expect(r.closed).toBe(true);
    expect(r.closingId).toBeTruthy();
    expect(r.survey.verdict).toBe("CLOSED");
    expect(r.survey.cash.differenceCents).toBe(0);
    const again = await autoCloseDay(db, { branchId: "b1", date: today, actualCents: 5_200_000 }, "u1");
    expect(again.closed).toBe(false);
  });

  it("downloads as CSV and as a well-formed PDF", async () => {
    const { surveyDay, surveyCsv, surveyPdf } = await import("./daysurvey");
    const s = await surveyDay(db, { branchId: "b2", date: today, actualCents: 100_000 });
    const csv = surveyCsv(s);
    expect(csv).toContain("FINDINGS");
    expect(csv).toContain("RECONCILIATION CHECKS");
    expect(csv).toContain("CLOSING REPORT");
    const pdf = new TextDecoder().decode(surveyPdf(s, "Test Jewellers"));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    // Every xref offset must land on its object header.
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    const offsets = pdf.slice(xrefAt).split("\n").filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
    offsets.forEach((off, i) => expect(pdf.slice(off, off + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});
