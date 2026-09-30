import { beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, totpCode } from "@goldos/shared";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { app } from "../app";
import type { Env } from "../db/client";
import { resetGateCache } from "./bridge";
import {
  beginMfaEnrolment,
  bootstrap,
  completeMfa,
  confirmMfaEnrolment,
  createAdmin,
  editAdmin,
  login,
  setAdminActive,
} from "./services/admins";
import { createCoupon, recordPayment, runBillingCycle, voidInvoice } from "./services/billing";
import { platformOverview } from "./services/metrics";
import { createImpersonation, updatePlatformSettings } from "./services/ops";
import { applyDiscount, cancelSubscription, changePlan } from "./services/subscriptions";
import { createTenant, getTenantDetail, suspendTenant } from "./services/tenants";

const BOOT = "bootstrap-secret-0123456789";

type Row = Record<string, unknown>;

describe.skipIf(!sqliteAvailable)("platform control plane over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  let admin: { id: string; ip: null };

  const one = (sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as Row;
  const all = (sql: string, ...v: unknown[]) => raw.prepare(sql).all(...v) as Row[];

  beforeEach(async () => {
    ({ db, raw } = migratedDb("drizzle-platform"));
    const { id } = await bootstrap(db, BOOT, { token: BOOT, email: "root@goldos.lk", name: "Root", password: "correct-horse-battery" }, null);
    admin = { id, ip: null };
  });

  async function tenant(overrides: Partial<Parameters<typeof createTenant>[1]> = {}) {
    return createTenant(
      db,
      {
        name: "Kandy Gold House",
        slug: `kandy-${Math.random().toString(36).slice(2, 8)}`,
        ownerName: "Nimal",
        ownerEmail: "owner@kandy.lk",
        country: "LK",
        currency: "LKR",
        timezone: "Asia/Colombo",
        region: "apac",
        planId: "plan-starter",
        interval: "MONTH",
        tags: [],
        ...overrides,
      },
      admin
    );
  }

  describe("provisioning and the subscription clock", () => {
    it("starts a trial with no invoice and no MRR", async () => {
      const { id, invoiceNumber } = await tenant();
      expect(invoiceNumber).toBeNull();
      const sub = one("SELECT * FROM subscriptions WHERE tenant_id = ?", id);
      expect(sub.status).toBe("TRIALING");
      expect((await platformOverview(db)).kpis.mrr_cents).toBe(0);
    });

    it("bills immediately when there is no trial, with tax after discount", async () => {
      await updatePlatformSettings(db, { tax_rate_bps: 1800 }, admin);
      const { invoiceNumber, id } = await tenant({ trialDays: 0 });
      expect(invoiceNumber).toBe("INV-000001");
      const inv = one("SELECT * FROM invoices WHERE tenant_id = ?", id);
      expect(inv.subtotal_cents).toBe(950000);
      expect(inv.tax_cents).toBe(171000);
      expect(inv.total_cents).toBe(1121000);
      expect(all("SELECT * FROM invoice_lines WHERE invoice_id = ?", inv.id).length).toBe(2);
    });

    it("converts an expired trial once, however often the cycle runs", async () => {
      const { id } = await tenant({ trialDays: 14 });
      const later = Date.now() + 15 * DAY_MS;
      const first = await runBillingCycle(db, null, later);
      expect(first.trialsConverted).toBe(1);
      expect(first.invoicesIssued).toBe(1);
      const second = await runBillingCycle(db, null, later);
      expect(second.trialsConverted + second.renewed + second.invoicesIssued).toBe(0);
      expect(all("SELECT id FROM invoices WHERE tenant_id = ?", id)).toHaveLength(1);
      expect(one("SELECT status FROM subscriptions WHERE tenant_id = ?", id).status).toBe("ACTIVE");
      expect((await platformOverview(db)).kpis.mrr_cents).toBe(950000);
    });

    it("renews at period end and issues the next invoice", async () => {
      const { id } = await tenant({ trialDays: 0 });
      const sub = one("SELECT current_period_end FROM subscriptions WHERE tenant_id = ?", id);
      const r = await runBillingCycle(db, null, Number(sub.current_period_end) + 1000);
      expect(r.renewed).toBe(1);
      expect(all("SELECT id FROM invoices WHERE tenant_id = ?", id)).toHaveLength(2);
    });

    it("cancels at period end and counts it as churn", async () => {
      const { id } = await tenant({ trialDays: 0 });
      await cancelSubscription(db, id, true, "Closing the shop", admin);
      expect(one("SELECT status FROM subscriptions WHERE tenant_id = ?", id).status).toBe("ACTIVE");
      const end = Number(one("SELECT current_period_end FROM subscriptions WHERE tenant_id = ?", id).current_period_end);
      const r = await runBillingCycle(db, null, end + 1);
      expect(r.canceled).toBe(1);
      expect(r.invoicesIssued).toBe(0);
      const o = await platformOverview(db);
      expect(o.kpis.mrr_cents).toBe(0);
      expect(o.movement30d.churn).toBe(950000);
    });
  });

  describe("dunning", () => {
    it("marks past due, suspends after grace, and a full payment restores everything", async () => {
      const { id } = await tenant({ trialDays: 0 });
      const inv = one("SELECT id, due_at, total_cents FROM invoices WHERE tenant_id = ?", id);
      const due = Number(inv.due_at);

      const r1 = await runBillingCycle(db, null, due + 1000);
      expect(r1.markedPastDue).toBe(1);
      expect(one("SELECT status FROM subscriptions WHERE tenant_id = ?", id).status).toBe("PAST_DUE");
      // Past-due revenue is still contracted revenue.
      expect((await platformOverview(db)).kpis.mrr_cents).toBe(950000);

      const r2 = await runBillingCycle(db, null, due + 15 * DAY_MS);
      expect(r2.suspended).toBe(1);
      const t = one("SELECT status, suspension_kind FROM tenants WHERE id = ?", id);
      expect(t).toMatchObject({ status: "SUSPENDED", suspension_kind: "BILLING" });

      await recordPayment(db, String(inv.id), { amountCents: 100, method: "BANK" }, admin);
      expect(one("SELECT status FROM tenants WHERE id = ?", id).status).toBe("SUSPENDED");
      await recordPayment(db, String(inv.id), { amountCents: Number(inv.total_cents) - 100, method: "BANK", reference: "TT-991" }, admin);
      expect(one("SELECT status FROM invoices WHERE id = ?", inv.id).status).toBe("PAID");
      expect(one("SELECT status FROM subscriptions WHERE tenant_id = ?", id).status).toBe("ACTIVE");
      expect(one("SELECT status, suspension_kind FROM tenants WHERE id = ?", id)).toMatchObject({ status: "ACTIVE", suspension_kind: null });
    });

    it("never lifts a manual suspension when money arrives", async () => {
      const { id } = await tenant({ trialDays: 0 });
      await suspendTenant(db, id, "Chargeback investigation", admin);
      const inv = one("SELECT id, total_cents FROM invoices WHERE tenant_id = ?", id);
      await recordPayment(db, String(inv.id), { amountCents: Number(inv.total_cents), method: "CARD" }, admin);
      expect(one("SELECT status, suspension_kind FROM tenants WHERE id = ?", id)).toMatchObject({ status: "SUSPENDED", suspension_kind: "MANUAL" });
    });

    it("rejects overpayment and voiding a paid invoice", async () => {
      const { id } = await tenant({ trialDays: 0 });
      const inv = one("SELECT id, total_cents FROM invoices WHERE tenant_id = ?", id);
      await expect(recordPayment(db, String(inv.id), { amountCents: Number(inv.total_cents) + 1, method: "BANK" }, admin)).rejects.toThrow(/exceeds/);
      await recordPayment(db, String(inv.id), { amountCents: 1, method: "BANK" }, admin);
      await expect(voidInvoice(db, String(inv.id), "Issued in error", admin)).rejects.toThrow(/uncollectible/);
    });
  });

  describe("revenue metrics", () => {
    it("tracks expansion and keeps the trend anchored to live MRR", async () => {
      const { id } = await tenant({ trialDays: 0 });
      await changePlan(db, id, { planId: "plan-growth", reason: "Opened a second branch" }, admin);
      const o = await platformOverview(db);
      expect(o.kpis.mrr_cents).toBe(2450000);
      expect(o.movement30d.new).toBe(950000);
      expect(o.movement30d.expansion).toBe(1500000);
      expect(o.trend.at(-1)?.mrr_cents).toBe(2450000);
      expect(o.trend).toHaveLength(12);
      expect(o.planMix[0]?.code).toBe("growth");
    });

    it("applies a coupon, counts the redemption, and drops it at the renewal after it ends", async () => {
      await createCoupon(db, { code: "LAUNCH20", description: "", percentOff: 20, durationMonths: 1, maxRedemptions: 1, expiresAt: null }, admin);
      const a = await tenant({ trialDays: 0 });
      await applyDiscount(db, a.id, { couponCode: "launch20", reason: "Launch offer" }, admin);
      expect(one("SELECT redeemed_count FROM coupons WHERE code = 'LAUNCH20'").redeemed_count).toBe(1);
      expect((await platformOverview(db)).kpis.mrr_cents).toBe(760000);

      const b = await tenant({ trialDays: 0 });
      await expect(applyDiscount(db, b.id, { couponCode: "LAUNCH20", reason: "Try again" }, admin)).rejects.toThrow(/fully redeemed/);

      // Within two renewals the one-month coupon lapses — at the first if it
      // was applied in the same millisecond the period began, else the second.
      let ended = 0;
      for (let i = 0; i < 2; i++) {
        const end = Number(one("SELECT current_period_end FROM subscriptions WHERE tenant_id = ?", a.id).current_period_end);
        ended += (await runBillingCycle(db, null, end + 1)).discountsEnded;
      }
      expect(ended).toBe(1);
      expect(one("SELECT discount_pct, coupon_id FROM subscriptions WHERE tenant_id = ?", a.id)).toMatchObject({ discount_pct: 0, coupon_id: null });
      const totals = all("SELECT discount_cents FROM invoices WHERE tenant_id = ? ORDER BY issued_at", a.id).map((r) => r.discount_cents);
      expect(totals.at(-1)).toBe(0);
    });

    it("reports limits against the plan on the account detail", async () => {
      const { id } = await tenant();
      raw.prepare("INSERT INTO usage_snapshots (id, tenant_id, users, branches, products, captured_at) VALUES ('u1', ?, 4, 1, 1990, ?)").run(id, Date.now());
      const d = await getTenantDetail(db, id);
      expect(d.limits?.users).toMatchObject({ used: 4, max: 5, near: true, over: false });
      expect(d.limits?.branches).toMatchObject({ used: 1, max: 1, over: true });
      expect(d.flags.find((f) => f.key === "pos")?.enabled).toBe(true);
      expect(d.flags.find((f) => f.key === "manufacturing")?.enabled).toBe(false);
    });
  });

  describe("staff security", () => {
    it("bootstrap needs the secret and works exactly once", async () => {
      const fresh = migratedDb("drizzle-platform").db;
      await expect(bootstrap(fresh, undefined, { token: BOOT, email: "a@b.co", name: "A", password: "x".repeat(12) }, null)).rejects.toThrow(/disabled/);
      await expect(bootstrap(fresh, BOOT, { token: "wrong-token-000000000", email: "a@b.co", name: "A", password: "x".repeat(12) }, null)).rejects.toThrow(/Invalid/);
      await bootstrap(fresh, BOOT, { token: BOOT, email: "a@b.co", name: "A", password: "x".repeat(12) }, null);
      await expect(bootstrap(fresh, BOOT, { token: BOOT, email: "c@d.co", name: "C", password: "x".repeat(12) }, null)).rejects.toThrow(/already/);
    });

    it("locks an account after five bad passwords", async () => {
      for (let i = 0; i < 5; i++) await expect(login(db, "root@goldos.lk", "wrong-password", null, null)).rejects.toThrow();
      await expect(login(db, "root@goldos.lk", "correct-horse-battery", null, null)).rejects.toThrow(/Too many/);
    });

    it("holds the session half-open until the TOTP code is proven", async () => {
      const { secret } = await beginMfaEnrolment(db, admin.id, "GoldOS");
      await confirmMfaEnrolment(db, admin.id, await totpCode(secret, Date.now()));
      const r = await login(db, "root@goldos.lk", "correct-horse-battery", null, null);
      expect(r.mfaRequired).toBe(true);
      const s = one("SELECT id, mfa_pending FROM platform_sessions ORDER BY created_at DESC LIMIT 1");
      expect(s.mfa_pending).toBe(1);
      await expect(completeMfa(db, String(s.id), admin.id, "000000", null)).rejects.toThrow(/Invalid/);
      await completeMfa(db, String(s.id), admin.id, await totpCode(secret, Date.now()), null);
      expect(one("SELECT mfa_pending FROM platform_sessions WHERE id = ?", s.id).mfa_pending).toBe(0);
    });

    it("always keeps one active super admin", async () => {
      const other = await createAdmin(db, { email: "ops@goldos.lk", name: "Ops", password: "y".repeat(12), role: "operations" }, admin);
      await expect(editAdmin(db, admin.id, { role: "analyst" }, { id: other.id, ip: null })).rejects.toThrow(/at least one/);
      await expect(setAdminActive(db, admin.id, false, "leaving", { id: other.id, ip: null })).rejects.toThrow(/at least one/);
      await expect(editAdmin(db, admin.id, { role: "analyst" }, admin)).rejects.toThrow(/own role/);
    });

    it("writes every change to the audit log", async () => {
      const { id } = await tenant();
      await suspendTenant(db, id, "Testing audit", admin);
      const actions = all("SELECT action FROM platform_audit_logs WHERE tenant_id = ? ORDER BY created_at", id).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["tenant.create", "tenant.suspend"]));
    });
  });

  describe("shop bridge", () => {
    let shop: { db: D1Database; raw: SqliteDb };
    let env: Env;
    let tenantId: string;

    beforeEach(async () => {
      shop = migratedDb();
      ({ id: tenantId } = await tenant());
      env = { DB: shop.db, PLATFORM_DB: db, TENANT_ID: tenantId, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000" };
      shop.raw
        .prepare("INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES ('u-owner', 'owner@kandy.lk', 'Nimal', 'x:y', 1, 0, 0)")
        .run();
      resetGateCache();
    });

    it("tells an anonymous caller the workspace status only", async () => {
      const res = await app.request("/api/v1/platform/context", {}, env);
      const body = (await res.json()) as { data: Row };
      expect(body.data).toMatchObject({ managed: true, tenant: { status: "ACTIVE" } });
      expect(body.data.subscription).toBeUndefined();
    });

    it("blocks a suspended workspace", async () => {
      await suspendTenant(db, tenantId, "Abuse report", admin);
      resetGateCache();
      const res = await app.request("/api/v1/auth/me", {}, env);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TENANT_SUSPENDED");
    });

    it("answers maintenance mode with 503", async () => {
      await updatePlatformSettings(db, { maintenance_mode: true, maintenance_message: "Back at 2am" }, admin);
      resetGateCache();
      const res = await app.request("/api/v1/auth/me", {}, env);
      expect(res.status).toBe(503);
    });

    it("enforces the plan's branch limit", async () => {
      shop.raw.prepare("INSERT INTO branches (id, name, code, is_active, created_at) VALUES ('b1', 'Main', 'MAIN', 1, 0)").run();
      const res = await app.request("/api/v1/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PLAN_LIMIT");
    });

    it("redeems an impersonation link exactly once and audits it in the shop", async () => {
      const grant = await createImpersonation(db, env, tenantId, { reason: "Reproducing a POS bug" }, admin);
      const token = new URL(grant.url).searchParams.get("token");
      const post = () =>
        app.request("/api/v1/platform/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }, env);
      const first = await post();
      expect(first.status).toBe(200);
      expect(first.headers.get("set-cookie")).toMatch(/^session=/);
      expect((await post()).status).toBe(401);
      const log = shop.raw.prepare("SELECT reason FROM audit_logs WHERE action = 'auth.impersonate'").get() as Row;
      expect(String(log.reason)).toMatch(/Root.*Reproducing a POS bug/);
    });

    it("does not burn the link when the target user is missing", async () => {
      const grant = await createImpersonation(db, env, tenantId, { targetEmail: "typo@kandy.lk", reason: "Mistyped target" }, admin);
      const token = new URL(grant.url).searchParams.get("token");
      const res = await app.request("/api/v1/platform/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }, env);
      expect(res.status).toBe(404);
      expect(one("SELECT consumed_at FROM impersonation_grants WHERE target_email = 'typo@kandy.lk'").consumed_at).toBeNull();
    });

    it("refuses a link minted for a different workspace", async () => {
      const { id: otherTenant } = await tenant();
      const grant = await createImpersonation(db, env, otherTenant, { reason: "Wrong shop" }, admin);
      const token = new URL(grant.url).searchParams.get("token");
      const res = await app.request("/api/v1/platform/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }, env);
      expect(res.status).toBe(401);
    });
  });
});
