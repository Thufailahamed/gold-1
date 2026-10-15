// The auto-close feature over HTTP, through the real app and real SQLite:
// login, permissions, the survey as JSON / CSV / PDF, a refused auto-close,
// a clean one, and a day closed by an older build whose snapshot lacks fields.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";

describe.skipIf(!sqliteAvailable)("day-close auto close over HTTP", () => {
  let raw: SqliteDb;
  let env: { DB: D1Database; R2: R2Bucket; WEB_ORIGIN: string };
  let app: (typeof import("../app"))["app"];
  let today: string;
  let owner = "";
  let cashier = "";
  const PASSWORD = "correct-horse-1";

  const login = async (email: string) => {
    const res = await app.request(
      "/api/v1/auth/login",
      { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "10.0.0.1" }, body: JSON.stringify({ email, password: PASSWORD }) },
      env
    );
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1] ?? "";
  };
  const get = (path: string, sid = owner) =>
    app.request(path, { headers: { cookie: `session=${sid}`, origin: "http://localhost:3000" } }, env);
  const post = (path: string, body: unknown, sid = owner) =>
    app.request(
      path,
      {
        method: "POST",
        headers: { cookie: `session=${sid}`, origin: "http://localhost:3000", "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      },
      env
    );

  beforeAll(async () => {
    const m = migratedDb();
    raw = m.raw;
    env = { DB: m.db, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000" };
    const { hashPassword } = await import("../services/hash");
    const hash = await hashPassword(PASSWORD);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','owner@shop.lk','Owner','${hash}',0,0), ('u2','cashier@shop.lk','Cashier','${hash}',0,0);
      INSERT INTO roles (id, name) VALUES ('viewer','viewer');
      INSERT INTO role_permissions (role_id, permission_id) VALUES ('viewer','accounts:view'), ('viewer','dayclose:view');
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','viewer');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u1','b2'), ('u2','b1');
    `);
    const { businessDateFor } = await import("../services/busdate");
    today = await businessDateFor(m.db, Date.now());
    const { createCashEntry } = await import("../services/cashentries");
    await createCashEntry(m.db, { branchId: "b1", kind: "OWNER_CAPITAL", amountCents: 5_000_000, method: "cash", note: "Float" }, "u1");
    await createCashEntry(m.db, { branchId: "b1", kind: "OTHER_INCOME", amountCents: 200_000, method: "cash", note: "Polishing" }, "u1");
    // Paid from the drawer, not yet approved: a warning, never a blocker.
    raw.exec(`INSERT INTO expenses (id, number, category_id, branch_id, incurred_on, amount_cents, description, payment_account_code, status, created_at, created_by)
              VALUES ('x1','EXP-0001','exp-utilities','b1','${today}',15000,'Water bill','1000','PENDING_APPROVAL',${Date.now()},'u1')`);
    // b2: closed yesterday by an older build — a snapshot with no card, gold balance or net-unclassified fields.
    const { addDays } = await import("@goldos/shared");
    const old = JSON.stringify({
      branchId: "b2", date: addDays(today, -1), openingCents: 0,
      cashIn: { totalCents: 0, unclassifiedCents: 0, lines: [] }, cashOut: { totalCents: 0, unclassifiedCents: 0, lines: [] },
      money: { salesCents: 0, purchasesCents: 0, oldGoldCents: 0, expensesCents: 0, customerPaymentsCents: 0, supplierPaymentsCents: 0, bankTransactionsCents: 0 },
      gold: {}, checks: { passed: true, failing: [], total: 3 },
      closing: { expectedCents: 0, differenceCents: 0, reasonRequired: false, awaitingApprovalCents: 0 },
    });
    raw
      .prepare(`INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents, difference_cents, report_json, checks_passed, status, closed_by, closed_at, created_at)
                VALUES ('old1','b2',?,0,0,0,0,0,0,?,1,'CLOSED','u1',1,1)`)
      .run(addDays(today, -1), old);
    ({ app } = await import("../app"));
    owner = await login("owner@shop.lk");
    cashier = await login("cashier@shop.lk");
  });

  it("surveys the day as JSON, naming what blocks the close", async () => {
    const res = await get(`/api/v1/day-closings/survey?branchId=b1&date=${today}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { verdict: string; cash: { expectedCents: number }; findings: { severity: string; title: string }[] } };
    expect(data.verdict).toBe("BLOCKED");
    expect(data.cash.expectedCents).toBe(5_200_000);
    expect(data.findings.find((f) => f.severity === "blocker")?.title).toBe("Drawer not counted");
    expect(data.findings).toContainEqual(expect.objectContaining({ severity: "warning", title: "1 expense awaiting approval" }));
  });

  it("rejects bad input instead of guessing", async () => {
    expect((await get(`/api/v1/day-closings/survey?branchId=b1`)).status).toBe(400);
    expect((await get(`/api/v1/day-closings/survey?branchId=b1&date=${today}&actualCents=12.5`)).status).toBe(400);
    expect((await post("/api/v1/day-closings/auto-close", { branchId: "b1" })).status).toBe(400);
  });

  it("serves the CSV and a real PDF", async () => {
    const csv = await get(`/api/v1/day-closings/survey.csv?branchId=b1&date=${today}&actualCents=5200000`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain(`day-close-survey-${today}.csv`);
    const text = await csv.text();
    expect(text).toContain("Verdict,READY");
    expect(text).toContain("EXP-0001");

    const pdf = await get(`/api/v1/day-closings/survey.pdf?branchId=b1&date=${today}&actualCents=5200000`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const body = new TextDecoder().decode(bytes);
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(body).toContain("READY TO CLOSE");
  });

  it("lets a reader survey but not auto-close", async () => {
    expect((await get(`/api/v1/day-closings/survey?branchId=b1&date=${today}`, cashier)).status).toBe(200);
    expect((await post("/api/v1/day-closings/auto-close", { branchId: "b1", date: today, actualCents: 5_200_000 }, cashier)).status).toBe(403);
  });

  it("refuses an unexplained short drawer and posts nothing", async () => {
    const res = await post("/api/v1/day-closings/auto-close", { branchId: "b1", date: today, actualCents: 5_100_000 });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { closed: boolean; survey: { verdict: string; findings: { title: string }[] } } };
    expect(data.closed).toBe(false);
    expect(data.survey.findings.map((f) => f.title)).toContain("Cash difference not explained");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM day_closings WHERE branch_id = 'b1'").get()).toMatchObject({ n: 0 });
  });

  it("blocks a note count that does not add up to the total", async () => {
    const res = await post("/api/v1/day-closings/auto-close", { branchId: "b1", date: today, actualCents: 5_200_000, denominations: { "5000": 1040 } });
    const { data } = (await res.json()) as { data: { closed: boolean; survey: { findings: { title: string }[] } } };
    expect(data.closed).toBe(false);
    expect(data.survey.findings.map((f) => f.title)).toContain("Note count does not add up");
  });

  it("closes an explained short drawer, posting the difference", async () => {
    const res = await post("/api/v1/day-closings/auto-close", {
      branchId: "b1", date: today, actualCents: 5_185_000, differenceReason: "Water bill paid from drawer",
      denominations: { "5000": 10, "1000": 1, "500": 1, "100": 3, "50": 1 },
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { closed: boolean; closingId: string; survey: { verdict: string; cash: { differenceCents: number; correctionCents: number } } } };
    expect(data.closed).toBe(true);
    expect(data.survey.verdict).toBe("CLOSED");
    expect(data.survey.cash.differenceCents).toBe(-15_000);
    expect(data.survey.cash.correctionCents).toBe(-15_000);
    const row = raw.prepare("SELECT status, actual_cents, denominations_json FROM day_closings WHERE id = ?").get(data.closingId);
    expect(row).toMatchObject({ status: "CLOSED", actual_cents: 5_185_000, denominations_json: JSON.stringify({ "5000": 10, "1000": 1, "500": 1, "100": 3, "50": 1 }) });

    // Downloading after the close reports the frozen record, whatever the query says.
    const after = await get(`/api/v1/day-closings/survey.csv?branchId=b1&date=${today}&actualCents=1`);
    expect(await after.text()).toContain("Verdict,CLOSED");
  });

  it("surveys a day closed by an older build without crashing", async () => {
    const { addDays } = await import("@goldos/shared");
    const res = await get(`/api/v1/day-closings/survey?branchId=b2&date=${addDays(today, -1)}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { verdict: string; card: { recordedCents: number } } };
    expect(data.verdict).toBe("CLOSED");
    expect(data.card.recordedCents).toBe(0);
    expect((await get(`/api/v1/day-closings/survey.pdf?branchId=b2&date=${addDays(today, -1)}`)).status).toBe(200);
  });
});
