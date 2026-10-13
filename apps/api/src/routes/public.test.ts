import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { Hono } from "hono";
import type { Env } from "../db/client";
import { hashPassword } from "../services/hash";
import { auth } from "./auth";
import { createPublicRoutes, resetPublicThrottle, type Provisioner } from "./public";
import { resetResolveCache } from "../platform/resolve";
import { resetGateCache } from "../platform/bridge";

function testApp(env: Env) {
  const fakeProvision: Provisioner = async (_env, pdb, input) => {
    const shop = migratedDb();
    const hash = await hashPassword(input.password);
    // Migrations already seed roles/permissions/chart/settings: only the
    // owner, their role grant, and the HQ branch are provisioned per shop.
    const now = Date.now();
    shop.raw.prepare("INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").run(
      "u-owner", input.ownerEmail.toLowerCase(), input.ownerName, hash, now, now);
    shop.raw.prepare("INSERT INTO user_roles (user_id, role_id) VALUES ('u-owner', 'owner')").run();
    shop.raw.prepare("INSERT INTO branches (id, name, code, is_active, created_at, created_by) VALUES ('b-hq', 'Main Branch', 'MAIN', 1, ?, 'u-owner')").run(now);
    shop.raw.prepare("INSERT INTO branch_members (user_id, branch_id) VALUES ('u-owner', 'b-hq')").run();
    const d1Id = `d1-${input.slug}`;
    await pdb.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").bind(input.tenantId, d1Id, `goldos-${input.slug}`, Date.now()).run();
    (env as unknown as { TEST_HANDLES: Record<string, D1Database> }).TEST_HANDLES[d1Id] = shop.db;
    return { d1Id, d1Name: `goldos-${input.slug}` };
  };
  const t = new Hono<{ Bindings: Env }>();
  t.route("/api/v1/public", createPublicRoutes({ provision: fakeProvision }));
  t.route("/api/v1/auth", auth);
  return t;
}

describe.skipIf(!sqliteAvailable)("public SaaS auth", () => {
  let pdb: { db: D1Database; raw: SqliteDb };
  let env: Env;
  let t: ReturnType<typeof testApp>;

  beforeEach(async () => {
    pdb = migratedDb("drizzle-platform");
    await pdb.db.prepare("INSERT INTO platform_settings (key, value_json, updated_at) VALUES ('signup_enabled', 'true', 0)").run();
    env = { DB: migratedDb().db, PLATFORM_DB: pdb.db, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000", TEST_HANDLES: {} } as unknown as Env;
    t = testApp(env);
    resetGateCache();
    resetResolveCache();
    resetPublicThrottle();
  });

  const signupBody = (overrides: Record<string, unknown> = {}) => ({
    shopName: "Kandy Gold House",
    slug: "kandy-gold",
    ownerName: "Amara Perera",
    ownerEmail: "owner@kandygold.lk",
    password: "correct-horse-10",
    planId: "plan-starter",
    interval: "MONTH",
    ...overrides,
  });

  it("lists public plans and hides internal ones", async () => {
    await pdb.db.prepare("UPDATE plans SET is_public = 0 WHERE code = 'enterprise'").run();
    const res = await t.request("/api/v1/public/plans", {}, env);
    expect(res.status).toBe(200);
    const codes = (((await res.json()) as { data: { plans: Array<{ code: string }> } }).data.plans).map((p) => p.code);
    expect(codes).toContain("starter");
    expect(codes).not.toContain("enterprise");
  });

  it("signs a shop up with a 14-day trial and logs the owner in", async () => {
    const res = await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody()) }, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { slug: string; loginUrl: string; user: { email: string } } };
    expect(body.data.slug).toBe("kandy-gold");
    expect(body.data.loginUrl).toBe("/login?shop=kandy-gold");
    const cookies = res.headers.getSetCookie?.() ?? [];
    expect(cookies.some((c) => c.startsWith("session="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("goldos_tenant=kandy-gold"))).toBe(true);
    const sub = await pdb.db.prepare("SELECT status, trial_ends_at, current_period_start FROM subscriptions WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'kandy-gold')").first<{ status: string; trial_ends_at: number; current_period_start: number }>();
    expect(sub?.status).toBe("TRIALING");
    expect(sub!.trial_ends_at - sub!.current_period_start).toBe(14 * 24 * 3600_000);
  });

  it("silently accepts honeypot fills without creating anything", async () => {
    const res = await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody({ company_website: "http://spam.example" })) }, env);
    expect(res.status).toBe(201);
    const count = await pdb.db.prepare("SELECT COUNT(*) AS n FROM tenants").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("rejects infrastructure slugs and taken slugs without leaking email", async () => {    const bad = await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody({ slug: "admin" })) }, env);
    expect(bad.status).toBe(400);
    await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody()) }, env);
    const clash = await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody({ ownerEmail: "someone-else@x.lk" })) }, env);
    expect(clash.status).toBe(409);
    expect(await clash.text()).not.toMatch(/kandygold|owner@/);
  });

  it("looks up shops by email and returns nothing for strangers", async () => {
    await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody()) }, env);
    const known = await t.request("/api/v1/auth/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@kandygold.lk" }) }, env);
    expect(known.status).toBe(200);
    expect(((await known.json()) as { data: { shops: Array<{ slug: string }> } }).data.shops.map((s) => s.slug)).toEqual(["kandy-gold"]);
    const unknown = await t.request("/api/v1/auth/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@nowhere.lk" }) }, env);
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as { data: { shops: unknown[] } }).data.shops).toEqual([]);
  });

  it("logs in against the picked shop only", async () => {
    await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody()) }, env);
    await t.request("/api/v1/public/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signupBody({ slug: "galle-gold", shopName: "Galle Gold", ownerEmail: "owner@kandygold.lk", password: "other-password-11" })) }, env);
    const wrong = await t.request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@kandygold.lk", password: "correct-horse-10", slug: "galle-gold" }) }, env);
    expect(wrong.status).toBe(401);
    const right = await t.request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@kandygold.lk", password: "correct-horse-10", slug: "kandy-gold" }) }, env);
    expect(right.status).toBe(200);
    const cookies = right.headers.getSetCookie?.() ?? [];
    expect(cookies.some((c) => c.startsWith("goldos_tenant=kandy-gold"))).toBe(true);
  });

  it("throttles lookup bursts", async () => {
    const body = JSON.stringify({ email: "nobody@nowhere.lk" });
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await t.request("/api/v1/auth/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body }, env);
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
