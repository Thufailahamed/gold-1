import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { app } from "../app";
import type { Env } from "../db/client";
import { bootstrap, login } from "../platform/services/admins";
import { createTenant } from "../platform/services/tenants";
import { recordPayment } from "../platform/services/billing";
import { resetGateCache } from "../platform/bridge";
import { resetResolveCache } from "../platform/resolve";

const BOOT = "bootstrap-secret-0123456789";

function fakeR2() {
  const store = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  return {
    store,
    bucket: {
      put: async (key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
        store.set(key, { bytes: value.slice(0), contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream" });
      },
      get: async (key: string) => {
        const hit = store.get(key);
        if (!hit) return null;
        return { arrayBuffer: async () => hit.bytes.slice(0), httpMetadata: { contentType: hit.contentType } };
      },
      delete: async (key: string) => {
        store.delete(key);
      },
    } as unknown as R2Bucket,
  };
}

describe.skipIf(!sqliteAvailable)("bank-slip billing over real SQLite", () => {
  let pdb: { db: D1Database; raw: SqliteDb };
  let shopA: { db: D1Database; raw: SqliteDb };
  let shopB: { db: D1Database; raw: SqliteDb };
  let env: Env;
  let r2: ReturnType<typeof fakeR2>;
  let tenantA = "";
  let tenantB = "";
  let invoiceA = "";
  let staffCookie = "";
  const admin = { id: "", ip: null } as { id: string; ip: null };

  async function seedShop(raw: SqliteDb, userId: string, sessionId: string) {
    const now = Date.now();
    raw.prepare("INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").run(
      userId, `${userId}@shop.lk`, userId, "salt:hash", now, now);
    raw.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
      sessionId, userId, now + 12 * 3600_000, now);
  }

  beforeEach(async () => {
    pdb = migratedDb("drizzle-platform");
    shopA = migratedDb();
    shopB = migratedDb();
    const { id } = await bootstrap(pdb.db, BOOT, { token: BOOT, email: "root@goldos.lk", name: "Root", password: "correct-horse-battery-12" }, null);
    admin.id = id;
    const loginRes = await login(pdb.db, "root@goldos.lk", "correct-horse-battery-12", null, null);
    staffCookie = `psession=${loginRes.token}`;
    const mkTenant = async (slug: string, d1: string) => {
      const t = await createTenant(pdb.db, {
        name: slug, slug, ownerName: "Owner", ownerEmail: `owner@${slug}.lk`,
        country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
        planId: "plan-starter", interval: "MONTH", trialDays: 0, tags: [],
      }, admin);
      await pdb.db.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").bind(t.id, d1, `goldos-${slug}`, 0).run();
      return t.id;
    };
    tenantA = await mkTenant("shop-a", "d1-a");
    tenantB = await mkTenant("shop-b", "d1-b");
    invoiceA = (await pdb.db.prepare("SELECT id FROM invoices WHERE tenant_id = ?").bind(tenantA).first<{ id: string }>())!.id;
    seedShop(shopA.raw, "u-a", "sid-a");
    seedShop(shopB.raw, "u-b", "sid-b");
    r2 = fakeR2();
    env = {
      DB: shopA.db, PLATFORM_DB: pdb.db, R2: r2.bucket, WEB_ORIGIN: "http://localhost:3000",
      TEST_HANDLES: { "d1-a": shopA.db, "d1-b": shopB.db },
    } as unknown as Env;
    resetGateCache();
    resetResolveCache();
  });

  const shopHeaders = (sid: string, slug: string) => ({ cookie: `session=${sid}; goldos_tenant=${slug}` });
  const upload = (sid: string, slug: string, file: File, invoiceId: string, bankRef = "DEP-001") => {
    const form = new FormData();
    form.set("file", file);
    form.set("invoiceId", invoiceId);
    form.set("bankRef", bankRef);
    return app.request("/api/v1/billing/slips", { method: "POST", headers: shopHeaders(sid, slug), body: form }, env);
  };
  const png = (bytes: number) => new File([new Uint8Array(bytes)], "slip.png", { type: "image/png" });

  it("rejects oversized and mistyped slips before any R2 write", async () => {
    const big = await upload("sid-a", "shop-a", png(6 * 1024 * 1024), invoiceA);
    expect(big.status).toBe(400);
    const txt = new File(["not an image"], "slip.txt", { type: "text/plain" });
    const wrong = await upload("sid-a", "shop-a", txt, invoiceA);
    expect(wrong.status).toBe(400);
    expect(r2.store.size).toBe(0);
  });

  it("uploads a slip, approves it in full and clears the debt", async () => {
    const up = await upload("sid-a", "shop-a", png(1024), invoiceA);
    expect(up.status).toBe(201);
    const receiptId = ((await up.json()) as { data: { id: string } }).data.id;
    const ok = await app.request(`/platform/v1/billing/receipts/${receiptId}/approve`, { method: "POST", headers: { cookie: staffCookie, "Content-Type": "application/json" }, body: "{}" }, env);
    expect(ok.status).toBe(200);
    expect((await pdb.db.prepare("SELECT status FROM invoices WHERE id = ?").bind(invoiceA).first<{ status: string }>())?.status).toBe("PAID");
    expect((await pdb.db.prepare("SELECT status FROM tenant_receipts WHERE id = ?").bind(receiptId).first<{ status: string }>())?.status).toBe("APPROVED");
  });

  it("refuses approval when the balance moved underneath", async () => {
    const up = await upload("sid-a", "shop-a", png(1024), invoiceA);
    const receiptId = ((await up.json()) as { data: { id: string } }).data.id;
    const inv = await pdb.db.prepare("SELECT total_cents FROM invoices WHERE id = ?").bind(invoiceA).first<{ total_cents: number }>();
    await recordPayment(pdb.db, invoiceA, { amountCents: Math.floor(inv!.total_cents / 2), method: "BANK", reference: "part" }, admin);
    const res = await app.request(`/platform/v1/billing/receipts/${receiptId}/approve`, { method: "POST", headers: { cookie: staffCookie, "Content-Type": "application/json" }, body: "{}" }, env);
    expect(res.status).toBe(400);
  });

  it("rejects with a reason and accepts a fresh upload after", async () => {
    const first = await upload("sid-a", "shop-a", png(512), invoiceA);
    const firstId = ((await first.json()) as { data: { id: string } }).data.id;
    const rej = await app.request(`/platform/v1/billing/receipts/${firstId}/reject`, { method: "POST", headers: { cookie: staffCookie, "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Unreadable scan, send again" }) }, env);
    expect(rej.status).toBe(200);
    expect((await pdb.db.prepare("SELECT status, reject_reason FROM tenant_receipts WHERE id = ?").bind(firstId).first<{ status: string; reject_reason: string }>())?.reject_reason).toBe("Unreadable scan, send again");
    const second = await upload("sid-a", "shop-a", png(512), invoiceA);
    expect(second.status).toBe(201);
    const mine = await app.request("/api/v1/billing/slips", { headers: shopHeaders("sid-a", "shop-a") }, env);
    expect((((await mine.json()) as { data: { rows: unknown[] } }).data.rows)).toHaveLength(2);
  });

  it("keeps each shop's slips invisible to the other", async () => {
    await upload("sid-a", "shop-a", png(512), invoiceA);
    const mine = await app.request("/api/v1/billing/slips", { headers: shopHeaders("sid-a", "shop-a") }, env);
    expect((((await mine.json()) as { data: { rows: unknown[] } }).data.rows)).toHaveLength(1);
    const theirs = await app.request("/api/v1/billing/slips", { headers: shopHeaders("sid-b", "shop-b") }, env);
    expect((((await theirs.json()) as { data: { rows: unknown[] } }).data.rows)).toHaveLength(0);
  });

  it("serves the slip bytes to its owner and to staff, nobody else", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const up = await upload("sid-a", "shop-a", new File([bytes], "slip.png", { type: "image/png" }), invoiceA);
    const receiptId = ((await up.json()) as { data: { id: string } }).data.id;
    const own = await app.request(`/api/v1/billing/slips/${receiptId}/download`, { headers: shopHeaders("sid-a", "shop-a") }, env);
    expect(own.status).toBe(200);
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(bytes);
    const other = await app.request(`/api/v1/billing/slips/${receiptId}/download`, { headers: shopHeaders("sid-b", "shop-b") }, env);
    expect(other.status).toBe(404);
    const staff = await app.request(`/platform/v1/billing/receipts/${receiptId}/download`, { headers: { cookie: staffCookie } }, env);
    expect(staff.status).toBe(200);
  });
});
