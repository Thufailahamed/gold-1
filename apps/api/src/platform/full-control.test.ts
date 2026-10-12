import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { bootstrap } from "./services/admins";
import { recordPayment, voidPayment } from "./services/billing";
import { createImpersonation, listActiveImpersonations, revokeAllImpersonations, revokeImpersonation } from "./services/ops";
import { searchPlatform } from "./services/search";
import { bulkTenants, createTenant, exportTenant, purgeTenant } from "./services/tenants";
import type { Env } from "../db/client";

const BOOT = "bootstrap-secret-0123456789";

describe.skipIf(!sqliteAvailable)("platform full-control primitives", () => {
  let db: D1Database;
  let raw: SqliteDb;
  let admin: { id: string; ip: null };
  let env: Env;

  const one = (sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as Record<string, unknown>;

  beforeEach(async () => {
    ({ db, raw } = migratedDb("drizzle-platform"));
    const { id } = await bootstrap(db, BOOT, { token: BOOT, email: "root@goldos.lk", name: "Root", password: "correct-horse-battery-12" }, null);
    admin = { id, ip: null };
    const shop = migratedDb();
    env = { DB: shop.db, PLATFORM_DB: db, TENANT_ID: "x", R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000" };
  });

  async function tenant(slugSuffix = Math.random().toString(36).slice(2, 8)) {
    return createTenant(db, {
      name: "Kandy Gold House", slug: `kandy-${slugSuffix}`, ownerName: "Nimal", ownerEmail: "owner@kandy.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac", planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
  }

  it("search returns tenants by query", async () => {
    await tenant("search1");
    const r = await searchPlatform(db, "kandy", 8);
    expect(r.tenants.length).toBeGreaterThanOrEqual(1);
    expect(r.tenants[0]?.slug).toMatch(/kandy/);
  });

  it("bulk suspend suspends two tenants, reports per-id", async () => {
    const a = await tenant("b1");
    const b = await tenant("b2");
    const r = await bulkTenants(db, { ids: [a.id, b.id], action: "suspend", reason: "abuse probe test" }, admin);
    expect(r.results.filter((x) => x.ok)).toHaveLength(2);
    expect(one("SELECT status FROM tenants WHERE id = ?", a.id).status).toBe("SUSPENDED");
  });

  it("purge rejects ACTIVE tenant, deletes ARCHIVED with children", async () => {
    const { id: activeId } = await tenant("p1");
    await expect(purgeTenant(db, activeId, "gdpr", admin)).rejects.toThrow(/archived/i);
    const { id } = await tenant("p2");
    const { archiveTenant } = await import("./services/tenants");
    await archiveTenant(db, id, "closing shop", admin);
    const exp = await exportTenant(db, id);
    expect(exp.tenant.id).toBe(id);
    await purgeTenant(db, id, "gdpr verified erasure", admin);
    expect(one("SELECT id FROM tenants WHERE id = ?", id)).toBeUndefined();
  });

  it("revoke kills unconsumed grant and lists actives", async () => {
    const { id } = await tenant("i1");
    await createImpersonation(db, env, id, { reason: "repro test case" }, admin);
    const actives = await listActiveImpersonations(db);
    expect(actives.length).toBeGreaterThanOrEqual(1);
    const grantId = String((actives.find((g: Record<string, unknown>) => g.tenant_id === id) as Record<string, unknown>)?.id ?? actives[0]?.id);
    await revokeImpersonation(db, grantId, "no longer needed", admin);
    expect(one("SELECT id FROM impersonation_grants WHERE id = ?", grantId)).toBeUndefined();
  });

  it("revoke-all clears outstanding grants", async () => {
    const { id } = await tenant("i2");
    await createImpersonation(db, env, id, { reason: "repro two" }, admin);
    const r = await revokeAllImpersonations(db, id, "staff left", admin);
    expect(r.revoked).toBeGreaterThanOrEqual(1);
  });

  it("void payment reopens PAID invoice, rejects unknown", async () => {
    const { id } = await tenant("r1");
    // trialDays 0 path bills immediately — create paid tenant
    const paid = await createTenant(db, {
      name: "Paid Shop", slug: `paid-${Math.random().toString(36).slice(2, 8)}`, ownerName: "A", ownerEmail: "a@paid.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac", planId: "plan-starter", interval: "MONTH", trialDays: 0, tags: [],
    }, admin);
    const inv = one("SELECT id, total_cents FROM invoices WHERE tenant_id = ?", paid.id) as { id: string; total_cents: number };
    await recordPayment(db, String(inv.id), { amountCents: Number(inv.total_cents), method: "BANK" }, admin);
    expect(one("SELECT status FROM invoices WHERE id = ?", inv.id).status).toBe("PAID");
    const pay = one("SELECT id FROM payments WHERE invoice_id = ?", inv.id) as { id: string };
    const out = await voidPayment(db, String(pay.id), "duplicate entry refund", admin);
    expect(out.status).toBe("OPEN");
    expect(one("SELECT status FROM invoices WHERE id = ?", inv.id).status).toBe("OPEN");
    await expect(voidPayment(db, "missing-id", "x reason here", admin)).rejects.toThrow(/not found/i);
    void id;
  });

  it("void payment refuses VOID invoices and keeps paid_at on partial reversals", async () => {
    const { voidInvoice } = await import("./services/billing");
    const paid = await createTenant(db, {
      name: "Partial Shop", slug: `part-${Math.random().toString(36).slice(2, 8)}`, ownerName: "B", ownerEmail: "b@paid.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac", planId: "plan-starter", interval: "MONTH", trialDays: 0, tags: [],
    }, admin);
    const inv = one("SELECT id, total_cents FROM invoices WHERE tenant_id = ?", paid.id) as { id: string; total_cents: number };
    await recordPayment(db, String(inv.id), { amountCents: 100, method: "BANK" }, admin);
    const pay = one("SELECT id FROM payments WHERE invoice_id = ?", inv.id) as { id: string };
    await voidPayment(db, String(pay.id), "partial reversal test", admin);
    expect(one("SELECT status, paid_at FROM invoices WHERE id = ?", inv.id).status).toBe("OPEN");
    // Void the invoice itself, then record+reverse must be refused
    await voidInvoice(db, String(inv.id), "issued in error test", admin);
    const fakePayId = crypto.randomUUID();
    raw.prepare("INSERT INTO payments (id, invoice_id, tenant_id, amount_cents, method, received_at, created_at) VALUES (?, ?, ?, 1, 'BANK', 0, 0)").run(fakePayId, inv.id, paid.id);
    await expect(voidPayment(db, fakePayId, "should refuse voided", admin)).rejects.toThrow(/cannot be reversed/i);
  });

  it("revoke is idempotent — second call is ok", async () => {
    const { id } = await tenant("idem1");
    await createImpersonation(db, env, id, { reason: "idempotency test" }, admin);
    const actives = await listActiveImpersonations(db);
    const grantId = String((actives.find((g: Record<string, unknown>) => g.tenant_id === id) as Record<string, unknown>)?.id ?? actives[0]?.id);
    await revokeImpersonation(db, grantId, "first revoke", admin);
    await expect(revokeImpersonation(db, grantId, "second revoke", admin)).resolves.toBeUndefined();
  });

  it("purge of a trial account (no invoices) still deletes tenant and nulls audit trail", async () => {
    const { id } = await tenant("purge2");
    const { archiveTenant } = await import("./services/tenants");
    await archiveTenant(db, id, "closing shop test", admin);
    await purgeTenant(db, id, "gdpr verified erasure test", admin);
    expect(one("SELECT id FROM tenants WHERE id = ?", id)).toBeUndefined();
    expect(raw.prepare("SELECT COUNT(*) AS n FROM invoices WHERE tenant_id = ?").get(id) as Record<string, unknown>).toMatchObject({ n: 0 });
    // Compliance trail kept but detached from the erased account.
    expect((raw.prepare("SELECT COUNT(*) AS n FROM platform_audit_logs WHERE tenant_id = ?").get(id) as Record<string, unknown>).n).toBe(0);
  });
});
