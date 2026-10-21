// Credit reminder SMS over real SQLite with the SMSlenz gateway stubbed.
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizePhone, renderTemplate } from "./sms";

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): { get(...v: unknown[]): unknown; all(...v: unknown[]): unknown[]; run(...v: unknown[]): unknown };
};
let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync;
} catch {
  DatabaseSync = null;
}
const norm = (v: unknown[]) => v.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x));
function d1(raw: SqliteDb): D1Database {
  const stmt = (sql: string, vals: unknown[] = []) => ({
    sql,
    vals,
    bind: (...v: unknown[]) => stmt(sql, norm(v)),
    first: async <T>() => (raw.prepare(sql).get(...vals) ?? null) as T,
    all: async <T>() => ({ results: raw.prepare(sql).all(...vals) as T[] }),
    run: async () => {
      raw.prepare(sql).run(...vals);
      return { success: true };
    },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { sql: string; vals: unknown[] }[]) => {
      raw.exec("BEGIN");
      try {
        for (const s of stmts) raw.prepare(s.sql).run(...s.vals);
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  } as unknown as D1Database;
}

describe("sms helpers", () => {
  it("normalises Sri Lankan numbers", () => {
    expect(normalizePhone("0771234567")).toBe("+94771234567");
    expect(normalizePhone("+94 77 123 4567")).toBe("+94771234567");
    expect(normalizePhone("94771234567")).toBe("+94771234567");
    expect(normalizePhone("771234567")).toBe("+94771234567");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it("fills the template", () => {
    const msg = renderTemplate("Hi {name}, LKR {amount} due at {shop} ({bills}) {oldest} {nope}", {
      name: "Nimal",
      amountCents: 4500000,
      shop: "Gold House",
      bills: 2,
      oldest: "2026-10-01",
    });
    expect(msg).toBe("Hi Nimal, LKR 45,000.00 due at Gold House (2) 2026-10-01 {nope}");
  });
});

describe.skipIf(!DatabaseSync)("credit reminders over real SQLite", () => {
  let db: D1Database;
  const now = Date.now();
  const calls: URLSearchParams[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: { success: true, data: { pages: 1, campaign_id: 7 } } };
  const gateway = (async (_url: string, init: RequestInit) => {
    calls.push(init.body as URLSearchParams);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    const raw = new DatabaseSync!(":memory:");
    raw.exec("PRAGMA foreign_keys = OFF");
    const dir = join(__dirname, "..", "..", "drizzle");
    for (const f of readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) raw.exec(readFileSync(join(dir, f), "utf8"));
    raw.exec("PRAGMA foreign_keys = ON");
    db = d1(raw);
    const { businessDateFor } = await import("./busdate");
    const today = await businessDateFor(db, now);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771234567','b1',0), ('c2','NoPhone',NULL,'b1',0);
    `);
    const { buildEntryStmts } = await import("./journal");
    for (const [cid, inv, n] of [["c1", "inv1", "SINV-0001"], ["c2", "inv2", "SINV-0002"]] as const) {
      const built = await buildEntryStmts(
        db,
        {
          lines: [
            { account: "1200", debitCents: 4500000, creditCents: 0, partyType: "customer" as const, partyId: cid },
            { account: "4000", debitCents: 0, creditCents: 4500000 },
          ],
          refEntity: "sale_invoice",
          refId: inv,
          refNo: n,
          branchId: "b1",
          actorId: "u1",
          auditAction: "sale.complete",
          auditEntity: "sale_invoice",
          auditEntityId: inv,
          sourceModule: "sales",
        },
        { entryDate: today }
      );
      await db.batch([
        db.prepare("INSERT INTO sales_invoices (id, number, customer_id, branch_id, subtotal_cents, discount_cents, total_cents, paid_cents, status, created_at, created_by) VALUES (?, ?, ?, 'b1', 5000000, 0, 5000000, 500000, 'PARTIAL', ?, 'u1')").bind(inv, n, cid, now),
        ...built.stmts,
        db.prepare("INSERT INTO sales_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, 500000, 'cash', 'sale_payment', ?, ?, 'u1')").bind(`${inv}-p1`, inv, `${inv}-p1`, now),
        db.prepare("INSERT INTO sales_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, 4500000, 'credit', 'sale_payment', ?, ?, 'u1')").bind(`${inv}-p2`, inv, `${inv}-p2`, now),
      ]);
    }
  });

  const configure = async (over: Record<string, unknown> = {}) => {
    const { saveConfig } = await import("./sms");
    await saveConfig(
      db,
      { userId: "42", apiKey: "secret-key-1234", senderId: "GoldHouse", shopName: "Gold House", template: "", autoEnabled: false, autoAfterDays: 0, repeatDays: 7, sendHour: 0, minAmountLkr: 0, ...over },
      "u1"
    );
  };

  it("masks the key and refuses to send before setup", async () => {
    const { getPublicConfig, sendReminders } = await import("./sms");
    await expect(sendReminders(db, ["c1"], { actorId: "u1" }, gateway)).rejects.toMatchObject({ code: "VALIDATION" });
    await configure();
    const pub = await getPublicConfig(db);
    expect(pub).toMatchObject({ configured: true, hasApiKey: true, senderId: "GoldHouse" });
    expect(pub.apiKeyMasked.endsWith("1234")).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("secret-key");
  });

  it("sends a manual reminder with the balance, and skips customers it cannot text", async () => {
    const { sendReminders, listSmsLog } = await import("./sms");
    const out = await sendReminders(db, ["c1", "c2"], { actorId: "u1" }, gateway);
    expect(out.map((o) => o.status)).toEqual(["SENT", "SKIPPED"]);
    const sent = calls.at(-1)!;
    expect(sent.get("contact")).toBe("+94771234567");
    expect(sent.get("sender_id")).toBe("GoldHouse");
    expect(sent.get("message")).toContain("45,000.00");
    const log = await listSmsLog(db, { page: 1, limit: 10 });
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({ status: "SENT", kind: "MANUAL" });
  });

  it("records a gateway failure", async () => {
    const { sendReminders, listSmsLog } = await import("./sms");
    reply = { status: 401, body: { success: false, message: "Invalid API key" } };
    const out = await sendReminders(db, ["c1"], { actorId: "u1" }, gateway);
    expect(out[0]).toMatchObject({ status: "FAILED", detail: "Invalid API key" });
    expect((await listSmsLog(db, { page: 1, limit: 10 })).rows[0]).toMatchObject({ status: "FAILED", error: "Invalid API key" });
    reply = { status: 200, body: { success: true, data: { pages: 1, campaign_id: 8 } } };
  });

  it("automatic run does nothing until enabled, then respects the repeat window", async () => {
    const { runAutoReminders } = await import("./sms");
    expect(await runAutoReminders(db, now, gateway)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    await configure({ autoEnabled: true });
    // c1 was texted today (manual) so it waits out the repeat window; c2 has no phone.
    const first = await runAutoReminders(db, now, gateway);
    expect(first.sent).toBe(0);
    // Past the window it goes out once, and not again the same day.
    const later = now + 8 * 86_400_000;
    const sendRun = await runAutoReminders(db, later, gateway);
    expect(sendRun.sent).toBe(1);
    expect((await runAutoReminders(db, later, gateway)).sent).toBe(0);
  });
});
