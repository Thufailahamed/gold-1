// Bill scanning and the daily brief over the real app and SQLite, with a
// scripted model standing in for Workers AI.
import { businessDate } from "@goldos/shared";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { interpretScan, type ScanCategory } from "./billscan";
import { numbersAreGrounded, ruleSummary, type BriefData } from "./brief";

const CATS: ScanCategory[] = [
  { id: "c1", name: "Rent" },
  { id: "c2", name: "Utilities" },
];

describe("interpretScan", () => {
  const scan = (raw: unknown) => interpretScan(raw, CATS, "2026-10-10", "m");

  it("reads a clean bill and matches the category by name", () => {
    const r = scan({ vendor: "Ceylon Electricity", date: "2026-10-03", total: "Rs. 12,500.50", currency: "Rs", description: "Power", category: "utilities" });
    expect(r).toMatchObject({ vendor: "Ceylon Electricity", date: "2026-10-03", amountLkr: 12500.5, categoryId: "c2", categoryName: "Utilities" });
    expect(r.warnings).toEqual([]);
  });

  it("refuses a foreign currency instead of guessing a rate", () => {
    const r = scan({ total: 99, currency: "USD", date: "2026-10-03" });
    expect(r.amountLkr).toBeNull();
    expect(r.warnings.join(" ")).toContain("USD");
  });

  it("drops a future or impossible date and says so", () => {
    expect(scan({ total: 10, date: "2026-12-01" }).date).toBeNull();
    expect(scan({ total: 10, date: "2026-02-30" }).date).toBeNull();
    expect(scan({ total: 10, date: "2026-12-01" }).warnings.join(" ")).toContain("future");
  });

  it("leaves an unknown category blank rather than inventing one", () => {
    const r = scan({ total: 10, date: "2026-10-01", category: "Snacks" });
    expect(r.categoryId).toBeNull();
  });

  it("warns on a missing total and a non-object answer", () => {
    expect(scan({ date: "2026-10-01" }).warnings.join(" ")).toContain("total");
    expect(scan("garbage").amountLkr).toBeNull();
  });
});

describe("brief wording guard", () => {
  const data: BriefData = {
    date: "2026-10-10",
    days: [{ branchId: "b1", branch: "Main", salesCents: 25_000_000, invoices: 12, expensesCents: 500_000 }],
    findings: [{ id: "x", severity: "alert", branchId: "b1", branch: "Main", title: "Cash was short yesterday by LKR 1,500.00", detail: "No reason was recorded for the difference." }],
  };

  it("accepts wording that only quotes figures from the findings", () => {
    expect(numbersAreGrounded("Sales were LKR 250,000.00 over 12 invoices. Cash was short by LKR 1,500.00.", data)).toBe(true);
  });

  it("rejects a figure the findings do not contain", () => {
    expect(numbersAreGrounded("Sales were LKR 260,000.00.", data)).toBe(false);
  });

  it("writes a plain correct summary without a model", () => {
    const s = ruleSummary(data);
    expect(s).toContain("LKR 250,000.00");
    expect(s).toContain("Cash was short yesterday");
  });
});

describe.skipIf(!sqliteAvailable)("bill scan and daily brief over real SQLite", () => {
  let raw: SqliteDb;
  let env: Record<string, unknown>;
  let app: (typeof import("../app"))["app"];
  const PASSWORD = "correct-horse-1";
  const sessions: Record<string, string> = {};
  let reply: unknown = null;
  let fail = false;
  const seen: { model: string; inputs: { messages: { content: unknown }[] } }[] = [];

  const asUser = (user: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: `session=${sessions[user]}` } }, env);
  const photo = (type = "image/jpeg", size = 64) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(size)], "bill.jpg", { type }));
    return form;
  };
  const expensesCount = () => (raw.prepare("SELECT COUNT(*) AS n FROM expenses").get() as { n: number }).n;
  const yesterday = () => new Date(Date.parse(`${businessDate(Date.now(), 330)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const m = migratedDb();
    raw = m.raw;
    env = {
      DB: m.db,
      R2: {} as R2Bucket,
      WEB_ORIGIN: "http://localhost:3000",
      AI: {
        run: async (model: string, inputs: { messages: { content: unknown }[] }) => {
          seen.push({ model, inputs });
          if (fail) throw new Error("model down");
          return reply;
        },
      },
    };
    const { hashPassword } = await import("../services/hash");
    const hash = await hashPassword(PASSWORD);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','owner@shop.lk','Owner','${hash}',0,0),
        ('u2','sales@shop.lk','Sales','${hash}',0,0),
        ('u3','viewer@shop.lk','Viewer','${hash}',0,0);
      INSERT INTO roles (id, name) VALUES ('books_viewer', 'books_viewer');
      INSERT INTO role_permissions (role_id, permission_id) VALUES ('books_viewer', 'accounts:view');
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','staff'), ('u3','books_viewer');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','City','CITY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1'), ('u3','b2');
    `);
    ({ app } = await import("../app"));
    for (const [u, email] of [["u1", "owner@shop.lk"], ["u2", "sales@shop.lk"], ["u3", "viewer@shop.lk"]] as const) {
      const res = await app.request(
        "/api/v1/auth/login",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) },
        env
      );
      sessions[u] = res.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1] ?? "";
    }
  });

  beforeEach(() => {
    seen.length = 0;
    fail = false;
  });

  describe("POST /expenses/scan", () => {
    const category = () => raw.prepare("SELECT id, name FROM expense_categories WHERE is_active = 1 LIMIT 1").get() as { id: string; name: string };

    it("suggests the form fields from a photo and posts nothing", async () => {
      const c = category();
      const today = businessDate(Date.now(), 330);
      reply = { choices: [{ message: { content: `\`\`\`json\n{"vendor":"Lanka Power","date":"${today}","total":"Rs 4,200.00","currency":"LKR","description":"Electricity","category":"${c.name}"}\n\`\`\`` } }] };
      const before = expensesCount();
      const res = await asUser("u1", "/api/v1/expenses/scan", { method: "POST", body: photo() });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { vendor: string; amountLkr: number; categoryId: string; date: string; warnings: string[] } };
      expect(body.data).toMatchObject({ vendor: "Lanka Power", amountLkr: 4200, categoryId: c.id, date: today });
      expect(expensesCount()).toBe(before);
      const sent = seen[0]?.inputs.messages[1]?.content as { type: string; image_url?: { url: string } }[];
      expect(sent[1]?.image_url?.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    });

    it("rejects a non-image and an oversize file before calling the model", async () => {
      expect((await asUser("u1", "/api/v1/expenses/scan", { method: "POST", body: photo("application/pdf") })).status).toBe(400);
      expect((await asUser("u1", "/api/v1/expenses/scan", { method: "POST", body: photo("image/png", 4 * 1024 * 1024 + 1) })).status).toBe(400);
      expect(seen).toHaveLength(0);
    });

    it("needs accounts:manage", async () => {
      expect((await asUser("u3", "/api/v1/expenses/scan", { method: "POST", body: photo() })).status).toBe(403);
      expect((await asUser("u2", "/api/v1/expenses/scan", { method: "POST", body: photo() })).status).toBe(403);
    });

    it("answers 503 when the model fails, and 503 when it returns no JSON", async () => {
      fail = true;
      expect((await asUser("u1", "/api/v1/expenses/scan", { method: "POST", body: photo() })).status).toBe(503);
      fail = false;
      reply = { choices: [{ message: { content: "I cannot read this." } }] };
      expect((await asUser("u1", "/api/v1/expenses/scan", { method: "POST", body: photo() })).status).toBe(503);
    });
  });

  describe("daily brief", () => {
    beforeAll(() => {
      raw.exec(`
        INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents,
          difference_cents, difference_reason, report_json, checks_passed, status, closed_by, closed_at, created_at)
        VALUES ('dc1','b1','${yesterday()}',0,0,0,100000,50000,-50000,NULL,'{}',1,'CLOSED','u1',0,0),
               ('dc2','b2','${yesterday()}',0,0,0,100000,100000,0,NULL,'{}',1,'CLOSED','u1',0,0);
      `);
    });

    it("finds a cash shortage in the ledger and words it only with grounded figures", async () => {
      reply = { choices: [{ message: { content: "Main was short by LKR 500.00 yesterday and no reason was recorded." } }] };
      const res = await asUser("u1", "/api/v1/assistant/brief/refresh", { method: "POST" });
      expect(res.status).toBe(200);
      const b = ((await res.json()) as { data: { summary: string; model: string; findings: { id: string; title: string; branch: string }[] } }).data;
      expect(b.findings.map((f) => f.id)).toContain("cash-diff:b1");
      expect(b.findings.find((f) => f.id === "cash-diff:b1")?.title).toBe("Cash was short yesterday by LKR 500.00");
      expect(b.model).not.toBe("rules");
      expect(b.summary).toContain("LKR 500.00");
    });

    it("falls back to the rule summary when the model quotes a figure that is not in the findings", async () => {
      raw.exec("DELETE FROM ai_briefs");
      reply = { choices: [{ message: { content: "Main was short by LKR 9,999.00." } }] };
      const res = await asUser("u1", "/api/v1/assistant/brief/refresh", { method: "POST" });
      const b = ((await res.json()) as { data: { summary: string; model: string } }).data;
      expect(b.model).toBe("rules");
      expect(b.summary).not.toContain("9,999");
    });

    it("falls back to the rule summary when the model is down", async () => {
      raw.exec("DELETE FROM ai_briefs");
      fail = true;
      const res = await asUser("u1", "/api/v1/assistant/brief/refresh", { method: "POST" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { data: { model: string } }).data.model).toBe("rules");
    });

    it("shows a branch-limited user only their branch, with no model wording of other branches", async () => {
      const res = await asUser("u3", "/api/v1/assistant/brief");
      const b = ((await res.json()) as { data: { findings: { branch: string }[]; model: string } }).data;
      expect(b.findings.every((f) => f.branch === "City")).toBe(true);
      expect(b.model).toBe("rules");
    });

    it("refuses users without accounts access and blocks refresh without accounts:manage", async () => {
      expect((await asUser("u2", "/api/v1/assistant/brief")).status).toBe(403);
      expect((await asUser("u3", "/api/v1/assistant/brief/refresh", { method: "POST" })).status).toBe(403);
    });

    it("the hourly tick writes one brief per day, only after the configured hour", async () => {
      const { maybeRunBrief } = await import("./brief");
      raw.exec("DELETE FROM ai_briefs");
      fail = true;
      const noon = Date.parse(`${businessDate(Date.now(), 330)}T06:30:00Z`); // 12:00 at +05:30
      const night = Date.parse(`${businessDate(Date.now(), 330)}T16:30:00Z`); // 22:00 at +05:30
      await maybeRunBrief(env as never, noon);
      expect((raw.prepare("SELECT COUNT(*) AS n FROM ai_briefs").get() as { n: number }).n).toBe(0);
      await maybeRunBrief(env as never, night);
      await maybeRunBrief(env as never, night + 60_000);
      expect((raw.prepare("SELECT COUNT(*) AS n FROM ai_briefs").get() as { n: number }).n).toBe(1);
    });
  });
});
