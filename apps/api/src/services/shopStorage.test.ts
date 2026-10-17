import { describe, expect, it } from "vitest";
import { scopedBucket, shopR2, shopStorageBytes, tenantPrefix } from "./shopStorage";
import type { Env } from "../db/client";

/** In-memory R2: enough of get/put/delete/list for these tests. */
function fakeR2() {
  const store = new Map<string, { body: ArrayBuffer; contentType?: string }>();
  const r2 = {
    async put(key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body, contentType: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = store.get(key);
      return o ? { arrayBuffer: async () => o.body, httpMetadata: { contentType: o.contentType } } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(opts: { prefix?: string; cursor?: string }) {
      const all = [...store.entries()].filter(([k]) => k.startsWith(opts.prefix ?? "")).map(([key, v]) => ({ key, size: v.body.byteLength }));
      return { objects: all, truncated: false };
    },
  };
  return { r2: r2 as unknown as R2Bucket, store };
}

const bytes = (n: number) => new Uint8Array(n).buffer;

describe("per-shop storage", () => {
  it("prefixes every key with the shop id", async () => {
    const { r2, store } = fakeR2();
    await scopedBucket(r2, "tenant-a").put("products/p1/a.jpg", bytes(10));
    expect([...store.keys()]).toEqual([`${tenantPrefix("tenant-a")}products/p1/a.jpg`]);
  });

  it("one shop cannot read or delete another shop's object, even with its exact key", async () => {
    const { r2, store } = fakeR2();
    const a = scopedBucket(r2, "tenant-a");
    const b = scopedBucket(r2, "tenant-b");
    await a.put("products/p1/a.jpg", bytes(10));
    expect(await b.get("products/p1/a.jpg")).toBeNull();
    await b.delete("products/p1/a.jpg");
    expect(store.size).toBe(1);
    expect(await a.get("products/p1/a.jpg")).not.toBeNull();
    // Two shops can use the same id without colliding.
    await b.put("products/p1/a.jpg", bytes(20));
    expect(store.size).toBe(2);
  });

  it("leaves unmanaged and pinned single-shop deploys untouched", async () => {
    const { r2, store } = fakeR2();
    const env = { R2: r2 } as unknown as Env;
    // No workspace slug resolved: legacy behaviour, no prefix.
    await shopR2({ env, get: () => undefined }).put("products/p1/a.jpg", bytes(5));
    expect([...store.keys()]).toEqual(["products/p1/a.jpg"]);
    // A pinned deploy has a tenant id but no slug: still no prefix.
    await shopR2({ env, get: (k) => (k === "tenantId" ? "pinned" : undefined) }).put("x.jpg", bytes(5));
    expect(store.has("x.jpg")).toBe(true);
    // A resolved workspace is scoped.
    await shopR2({ env, get: (k) => (k === "tenantId" ? "t1" : k === "tenantSlug" ? "shop-1" : undefined) }).put("y.jpg", bytes(5));
    expect(store.has("t/t1/y.jpg")).toBe(true);
  });

  it("meters only the shop's own bytes", async () => {
    const { r2 } = fakeR2();
    await scopedBucket(r2, "tenant-a").put("a.jpg", bytes(1000));
    await scopedBucket(r2, "tenant-a").put("b.jpg", bytes(500));
    await scopedBucket(r2, "tenant-b").put("c.jpg", bytes(9999));
    expect(await shopStorageBytes(r2, "tenant-a")).toBe(1500);
    expect(await shopStorageBytes(r2, "tenant-b")).toBe(9999);
    expect(await shopStorageBytes(r2, "tenant-none")).toBe(0);
  });
});

import { Hono } from "hono";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";
import { enforceStorageLimit } from "./shopStorage";

describe.skipIf(!sqliteAvailable)("storage limit", () => {
  function setup(usedMb: number | null, maxMb: number | null) {
    const pdb = migratedDb("drizzle-platform");
    pdb.raw.prepare("INSERT INTO tenants (id, slug, name, owner_name, owner_email, created_at, updated_at) VALUES ('t1','s1','S','O','o@x.lk',0,0)").run();
    pdb.raw.prepare("UPDATE plans SET max_storage_mb = ? WHERE id = 'plan-starter'").run(maxMb);
    pdb.raw.prepare("INSERT INTO subscriptions (id, tenant_id, plan_id, status, price_cents, current_period_start, current_period_end, created_at, updated_at) VALUES ('sub1','t1','plan-starter','ACTIVE',0,0,1,0,0)").run();
    if (usedMb !== null)
      pdb.raw.prepare("INSERT INTO usage_snapshots (id, tenant_id, users, branches, products, sales_30d, sales_30d_cents, storage_mb, captured_at) VALUES ('u1','t1',0,0,0,0,0,?,1)").run(usedMb);
    const app = new Hono<{ Bindings: Env; Variables: { tenantId?: string; tenantSlug?: string } }>();
    app.use("*", async (c, next) => {
      c.set("tenantId", "t1");
      c.set("tenantSlug", "s1");
      await next();
    });
    app.post("/up", enforceStorageLimit, (c) => c.json({ ok: true }));
    const env = { PLATFORM_DB: pdb.db } as unknown as Env;
    const post = (mb: number) => app.request("/up", { method: "POST", headers: { "content-length": String(mb * 1024 * 1024) } }, env);
    return { post };
  }

  it("allows an upload that fits and refuses one that does not", async () => {
    const { post } = setup(90, 100);
    expect((await post(5)).status).toBe(200);
    const over = await post(11);
    expect(over.status).toBe(403);
    expect(((await over.json()) as { error: { code: string } }).error.code).toBe("PLAN_LIMIT");
  });

  it("does not limit unlimited plans or shops without a snapshot yet", async () => {
    expect((await setup(500, null).post(50)).status).toBe(200);
    expect((await setup(null, 100).post(5)).status).toBe(200);
  });
});
