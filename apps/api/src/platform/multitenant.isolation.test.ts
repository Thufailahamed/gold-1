import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { app } from "../app";
import type { Env } from "../db/client";
import { resetGateCache } from "./bridge";
import { resetResolveCache } from "./resolve";

function seedShop(raw: SqliteDb, userId: string, sessionId: string) {
  const now = Date.now();
  raw.prepare("INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").run(
    userId, `${userId}@shop.lk`, userId, "salt:hash", now, now
  );
  raw.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    sessionId, userId, now + 12 * 3600_000, now
  );
}

function seedTenant(pdb: SqliteDb, slug: string, opts: { status?: string; d1Id?: string } = {}) {
  const now = Date.now();
  pdb.prepare(
    "INSERT INTO tenants (id, slug, name, owner_name, owner_email, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(`t-${slug}`, slug, slug, "Owner", "o@x.lk", opts.status ?? "ACTIVE", now, now);
  if (opts.d1Id) {
    pdb.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").run(
      `t-${slug}`, opts.d1Id, `goldos-${slug}`, now
    );
  }
}

describe.skipIf(!sqliteAvailable)("multitenant isolation over real SQLite", () => {
  let pdb: { db: D1Database; raw: SqliteDb };
  let shopA: { db: D1Database; raw: SqliteDb };
  let shopB: { db: D1Database; raw: SqliteDb };
  let shopC: { db: D1Database; raw: SqliteDb };
  let env: Env;

  beforeEach(async () => {
    pdb = migratedDb("drizzle-platform");
    shopA = migratedDb();
    shopB = migratedDb();
    shopC = migratedDb();
    seedShop(shopA.raw, "u-a", "sid-a");
    seedShop(shopB.raw, "u-b", "sid-b");
    seedShop(shopC.raw, "u-c", "sid-c");
    seedTenant(pdb.raw, "shop-a", { d1Id: "d1-a" });
    seedTenant(pdb.raw, "shop-b", { d1Id: "d1-b" });
    seedTenant(pdb.raw, "shop-c", { status: "SUSPENDED", d1Id: "d1-c" });
    env = {
      DB: shopA.db,
      PLATFORM_DB: pdb.db,
      R2: {} as R2Bucket,
      WEB_ORIGIN: "http://localhost:3000",
      CLOUDFLARE_ACCOUNT_ID: "acct-test",
      CLOUDFLARE_D1_API_TOKEN: "tok-test",
      TEST_HANDLES: { "d1-a": shopA.db, "d1-b": shopB.db, "d1-c": shopC.db },
    } as unknown as Env;
    resetGateCache();
    resetResolveCache();
  });

  it("rejects a session replayed into another workspace", async () => {
    const res = await app.request("/api/v1/auth/me", { headers: { cookie: "session=sid-a; goldos_tenant=shop-b" } }, env);
    expect(res.status).toBe(401);
  });

  it("serves the right workspace when the cookie matches", async () => {
    const res = await app.request("/api/v1/auth/me", { headers: { cookie: "session=sid-b; goldos_tenant=shop-b" } }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { user: { id: string } } }).data.user.id).toBe("u-b");
  });

  it("blocks a suspended workspace before auth", async () => {
    const res = await app.request("/api/v1/auth/me", { headers: { cookie: "session=sid-c; goldos_tenant=shop-c" } }, env);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TENANT_SUSPENDED");
  });

  it("passes unmanaged deploys straight through", async () => {
    const plain = { DB: shopA.db, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000" } as unknown as Env;
    const res = await app.request("/api/v1/auth/me", { headers: { cookie: "session=sid-a" } }, plain);
    expect(res.status).toBe(200);
  });
});
