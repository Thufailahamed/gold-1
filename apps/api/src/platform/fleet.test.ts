import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import type { Env } from "../db/client";
import { collectAllUsage } from "./services/ops";
import { archiveTenant, createTenant } from "./services/tenants";
import { purgeTenantWithDatabase, type CfClient } from "./provision";

describe.skipIf(!sqliteAvailable)("saas fleet cutover", () => {
  let pdb: { db: D1Database; raw: SqliteDb };
  let env: Env;
  const admin = { id: "admin-1", ip: null } as { id: string; ip: null };

  async function tenant(slug: string, d1Id: string | null) {
    const t = await createTenant(pdb.db, {
      name: slug, slug, ownerName: "Owner", ownerEmail: `owner@${slug}.lk`,
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
      planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    if (d1Id) {
      await pdb.db.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").bind(t.id, d1Id, `goldos-${slug}`, 0).run();
    }
    return t.id;
  }

  function shopWithActivity(): { db: D1Database; raw: SqliteDb } {
    const shop = migratedDb();
    const now = Date.now();
    shop.raw.prepare("INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES ('u', 'u@x.lk', 'U', 'h', 1, ?, ?)").run(now, now);
    shop.raw.prepare("INSERT INTO audit_logs (id, user_id, action, entity, entity_id, created_at) VALUES ('a', 'u', 'x.y', 'e', '1', ?)").run(now);
    return shop;
  }

  beforeEach(async () => {
    pdb = migratedDb("drizzle-platform");
    env = { DB: migratedDb().db, PLATFORM_DB: pdb.db, R2: {} as R2Bucket, WEB_ORIGIN: "http://localhost:3000", TEST_HANDLES: {} } as unknown as Env;
  });

  it("collects usage from reachable shops and counts the rest", async () => {
    const shopA = shopWithActivity();
    const shopB = shopWithActivity();
    await tenant("shop-a", "d1-a");
    await tenant("shop-b", "d1-b");
    await tenant("shop-c", "d1-c");
    (env as unknown as { TEST_HANDLES: Record<string, D1Database> }).TEST_HANDLES = { "d1-a": shopA.db, "d1-b": shopB.db };
    const out = await collectAllUsage(pdb.db, env);
    expect(out.collected).toBe(2);
    expect(out.unreachable).toBe(1);
    expect(out.errors).toEqual([]);
    const snaps = await pdb.db.prepare("SELECT COUNT(*) AS n FROM usage_snapshots").first<{ n: number }>();
    expect(snaps?.n).toBe(2);
  });

  it("purge deletes the shop database first, then the rows", async () => {
    const dbs = new Map<string, SqliteDb>();
    const calls: string[] = [];
    const client: CfClient = {
      createDatabase: async (name: string) => ({ id: "d1-x", name }),
      applySql: async () => undefined,
      deleteDatabase: async (d1Id: string) => {
        calls.push(`delete:${d1Id}`);
        dbs.delete(d1Id);
      },
    };
    const id = await tenant("shop-p", "d1-p");
    dbs.set("d1-p", shopWithActivity().raw);
    await archiveTenant(pdb.db, id, "closing", admin);
    const out = await purgeTenantWithDatabase(env, pdb.db, id, "gdpr verified erasure", admin, client);
    expect(out).toMatchObject({ purged: id, d1Deleted: true });
    expect(calls).toEqual(["delete:d1-p"]);
    expect(dbs.has("d1-p")).toBe(false);
    expect(await pdb.db.prepare("SELECT id FROM tenants WHERE id = ?").bind(id).first()).toBeNull();
    expect(await pdb.db.prepare("SELECT tenant_id FROM tenant_databases WHERE tenant_id = ?").bind(id).first()).toBeNull();
  });

  it("purge without a shop database only removes rows", async () => {
    const id = await tenant("shop-legacy", null);
    await archiveTenant(pdb.db, id, "closing", admin);
    const out = await purgeTenantWithDatabase(env, pdb.db, id, "gdpr", admin);
    expect(out).toMatchObject({ purged: id, d1Deleted: false });
  });
});
