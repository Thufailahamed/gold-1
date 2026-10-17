import { beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { Hono } from "hono";
import type { Env } from "./client";
import { DoD1, doTransport } from "./do-d1";
import { runShopRequest, type SqlRunner } from "./shop-do";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { createPublicRoutes, resetPublicThrottle } from "../routes/public";
import { auth } from "../routes/auth";
import { products } from "../routes/products";
import { provisionShop, purgeTenantWithDatabase } from "../platform/provision";
import { resolveShopDb, resetResolveCache, resolveTenant } from "../platform/resolve";
import { resetGateCache } from "../platform/bridge";
import { runFleetMigrations } from "../platform/services/fleet";
import { archiveTenant } from "../platform/services/tenants";

const require = createRequire(import.meta.url);
const DatabaseSync = require("node:sqlite").DatabaseSync as new (path: string) => SqliteDb;

/** The production SqlRunner contract over node:sqlite, foreign keys enforced like D1. */
function sqliteRunner(raw: SqliteDb): SqlRunner {
  raw.exec("PRAGMA foreign_keys = ON");
  return {
    query: (sql, params) => raw.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>,
    transaction: (fn) => {
      raw.exec("BEGIN");
      try {
        const r = fn();
        raw.exec("COMMIT");
        return r;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

/** A DurableObjectNamespace stand-in: one in-memory SQLite per name, speaking the real fetch protocol. */
function fakeNamespace() {
  const dbs = new Map<string, SqliteDb>();
  const destroyed: string[] = [];
  const ns = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      async fetch(url: string, init?: { body?: string }) {
        if (new URL(url).pathname === "/destroy") {
          dbs.delete(name);
          destroyed.push(name);
          return new Response(JSON.stringify({ ok: true }));
        }
        if (!dbs.has(name)) dbs.set(name, new DatabaseSync(":memory:"));
        try {
          const results = runShopRequest(sqliteRunner(dbs.get(name)!), JSON.parse(init!.body!));
          return new Response(JSON.stringify({ ok: true, results }));
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      },
    }),
  };
  return { ns: ns as unknown as DurableObjectNamespace, dbs, destroyed };
}

describe.skipIf(!sqliteAvailable)("shop Durable Object database", () => {
  it("behaves like D1 for first/all/run and reports changes", async () => {
    const { ns } = fakeNamespace();
    const db = new DoD1(doTransport(ns, "s1")) as unknown as D1Database;
    await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
    const ins = await db.prepare("INSERT INTO t (name) VALUES (?)").bind("a").run();
    expect(ins.meta?.changes).toBe(1);
    await db.prepare("INSERT INTO t (name) VALUES (?)").bind("b").run();
    expect(await db.prepare("SELECT name FROM t WHERE id = ?").bind(1).first<{ name: string }>()).toEqual({ name: "a" });
    expect(await db.prepare("SELECT name FROM t WHERE id = ?").bind(1).first("name")).toBe("a");
    expect(await db.prepare("SELECT name FROM t WHERE id = ?").bind(99).first()).toBeNull();
    expect((await db.prepare("SELECT name FROM t ORDER BY id").all<{ name: string }>()).results.map((r) => r.name)).toEqual(["a", "b"]);
    expect((await db.prepare("DELETE FROM t").run()).meta?.changes).toBe(2);
  });

  it("rolls the whole batch back on any failure", async () => {
    const { ns } = fakeNamespace();
    const db = new DoD1(doTransport(ns, "s1")) as unknown as D1Database;
    await db.prepare("CREATE TABLE t (id TEXT PRIMARY KEY)").run();
    await expect(
      db.batch([db.prepare("INSERT INTO t VALUES (?)").bind("x"), db.prepare("INSERT INTO t VALUES (?)").bind("x")])
    ).rejects.toThrow(/UNIQUE/i);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM t").first<{ n: number }>())?.n).toBe(0);
  });

  it("keeps shops apart: same name is one database, different names never meet", async () => {
    const { ns } = fakeNamespace();
    const a = new DoD1(doTransport(ns, "a")) as unknown as D1Database;
    const b = new DoD1(doTransport(ns, "b")) as unknown as D1Database;
    await a.prepare("CREATE TABLE t (v TEXT)").run();
    await a.prepare("INSERT INTO t VALUES ('secret')").run();
    await expect(b.prepare("SELECT * FROM t").all()).rejects.toThrow(/no such table/i);
  });

  describe("provisioned through the SHOP binding, with no Cloudflare API credentials", () => {
    let pdb: { db: D1Database; raw: SqliteDb };
    let world: ReturnType<typeof fakeNamespace>;
    let env: Env;

    function app() {
      const a = new Hono<{ Bindings: Env }>();
      a.route("/api/v1/public", createPublicRoutes({ provision: provisionShop }));
      a.use("/api/v1/*", resolveTenant);
      a.route("/api/v1/auth", auth);
      a.route("/api/v1/products", products);
      return a;
    }
    const signup = (slug: string, email: string) =>
      app().request(
        "/api/v1/public/signup",
        { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": `10.0.0.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify({ shopName: slug, slug, ownerName: "O", ownerEmail: email, password: "correct-horse-10", planId: "plan-starter" }) },
        env
      );

    beforeEach(async () => {
      pdb = migratedDb("drizzle-platform");
      await pdb.db.prepare("INSERT INTO platform_settings (key, value_json, updated_at) VALUES ('signup_enabled', 'true', 0)").run();
      world = fakeNamespace();
      env = { DB: migratedDb().db, PLATFORM_DB: pdb.db, R2: {} as R2Bucket, SHOP: world.ns, WEB_ORIGIN: "http://localhost:3000" } as unknown as Env;
      resetGateCache();
      resetResolveCache();
      resetPublicThrottle();
    });

    it("signs up, migrates atomically with foreign keys enforced, and logs in", async () => {
      const res = await signup("kandy-gold", "owner@kandy.lk");
      expect(res.status).toBe(201);
      const link = await pdb.db.prepare("SELECT d1_id, schema_version FROM tenant_databases").first<{ d1_id: string; schema_version: string }>();
      expect(link?.d1_id.startsWith("do:goldos-kandy-gold-")).toBe(true);
      expect(link?.schema_version).toMatch(/^\d{4}_/);
      const login = await app().request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@kandy.lk", password: "correct-horse-10", slug: "kandy-gold" }) }, env);
      expect(login.status).toBe(200);
    });

    it("two shops are fully independent through the real request path", async () => {
      await signup("alpha", "owner@alpha.lk");
      await signup("beta", "owner@beta.lk");
      const token = async (slug: string, email: string) => {
        const r = await app().request("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "correct-horse-10", slug }) }, env);
        return ((await r.json()) as { data: { token: string } }).data.token;
      };
      const ta = await token("alpha", "owner@alpha.lk");
      const tb = await token("beta", "owner@beta.lk");
      const { db: alphaDb } = await resolveShopDb(env, "alpha");
      await alphaDb.prepare("INSERT INTO products (id, barcode, sku, category_id, metal_type_id, purity_id, name, gross_mg, stone_mg, net_mg, fine_gold_mg, making_cents, wastage_mg, cost_cents, selling_price_cents, status, branch_id, created_at) SELECT 'p1','B1','S1',(SELECT id FROM categories LIMIT 1),(SELECT id FROM metal_types LIMIT 1),(SELECT id FROM purities LIMIT 1),'alpha ring',1000,0,1000,916,0,0,0,0,'IN_STOCK',(SELECT id FROM branches LIMIT 1),0").run();
      const list = async (slug: string, tok: string) => {
        const r = await app().request("/api/v1/products", { headers: { "X-Session-Id": tok, "X-Shop-Slug": slug } }, env);
        return { status: r.status, body: (await r.json()) as { data?: { rows: unknown[] } } };
      };
      expect((await list("alpha", ta)).body.data?.rows).toHaveLength(1);
      expect((await list("beta", tb)).body.data?.rows).toHaveLength(0);
      expect((await list("beta", ta)).status).toBe(401);
      expect((await list("alpha", tb)).status).toBe(401);
    });

    it("fleet migration adopts and migrates a DO shop, and purge destroys its storage", async () => {
      await signup("kandy-gold", "owner@kandy.lk");
      const r = await runFleetMigrations(env, pdb.db);
      expect(r).toMatchObject({ shops: 1, upToDate: 1, failed: 0 });
      const t = await pdb.db.prepare("SELECT id FROM tenants WHERE slug = 'kandy-gold'").first<{ id: string }>();
      await archiveTenant(pdb.db, t!.id, "test", { id: "admin-1", ip: null });
      const out = await purgeTenantWithDatabase(env, pdb.db, t!.id, "test", { id: "admin-1", ip: null });
      expect(out.d1Deleted).toBe(true);
      expect(world.destroyed).toHaveLength(1);
      expect(world.dbs.size).toBe(0);
    });
  });
});
