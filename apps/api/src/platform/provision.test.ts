import { beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import type { Env } from "../db/client";
import { SHOP_MIGRATIONS } from "../db/shop-migrations";
import { provisionShop, restCfClient, retryProvision, type CfClient, type CfQuery, type ProvisionInput } from "./provision";
import { createTenant, suspendTenant } from "./services/tenants";

const require = createRequire(import.meta.url);
const DatabaseSync = require("node:sqlite").DatabaseSync as new (path: string) => SqliteDb;

/** Test-only `?` substitution (values are controlled fixtures, never user SQL). */
function fill(sql: string, params: unknown[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

type FakeWorld = { client: CfClient; dbs: Map<string, SqliteDb>; calls: string[] };

function fakeWorld(opts: { clashFirstCreate?: boolean } = {}): FakeWorld {
  const dbs = new Map<string, SqliteDb>();
  const calls: string[] = [];
  let n = 0;
  let migrated = new Set<string>();
  const client: CfClient = {
    async createDatabase(name: string) {
      calls.push(`create:${name}`);
      if (opts.clashFirstCreate && n === 0) {
        n += 1;
        throw Object.assign(new Error("database name already exists"), { status: 409 });
      }
      const id = `d1-test-${++n}`;
      dbs.set(id, new DatabaseSync(":memory:"));
      return { id, name };
    },
    async applySql(d1Id: string, queries: CfQuery[]) {
      calls.push(`apply:${d1Id}:${queries.length}`);
      const raw = dbs.get(d1Id);
      if (!raw) throw new Error("unknown database");
      // Like the real migration runner: constraints off while the schema
      // lands (0002 references roles 0004 creates), on for the seed.
      const first = !migrated.has(d1Id);
      if (first) raw.exec("PRAGMA foreign_keys = OFF");
      for (const q of queries) raw.exec(fill(q.sql, q.params ?? []));
      if (first) {
        raw.exec("PRAGMA foreign_keys = ON");
        migrated.add(d1Id);
      }
    },
    async deleteDatabase(d1Id: string) {
      calls.push(`delete:${d1Id}`);
      dbs.delete(d1Id);
    },
  };
  return { client, dbs, calls };
}

const input: ProvisionInput = {
  tenantId: "t-kandy",
  slug: "kandy-gold",
  shopName: "Kandy Gold House",
  ownerName: "Amara Perera",
  ownerEmail: "Owner@KandyGold.lk",
  password: "correct-horse-10",
  country: "LK",
  currency: "LKR",
  timezone: "Asia/Colombo",
};

describe.skipIf(!sqliteAvailable)("in-worker provisioning", () => {
  let pdb: D1Database;
  let env: Env;

  beforeEach(async () => {
    ({ db: pdb } = migratedDb("drizzle-platform"));
    env = { DB: migratedDb().db, PLATFORM_DB: pdb, R2: {} as R2Bucket } as unknown as Env;
  });

  it("bundles every shop migration in order", () => {
    expect(SHOP_MIGRATIONS.length).toBeGreaterThanOrEqual(43);
    expect(SHOP_MIGRATIONS[0]!.name).toMatch(/^0001_/);
    for (let i = 1; i < SHOP_MIGRATIONS.length; i++) {
      expect(SHOP_MIGRATIONS[i]!.name > SHOP_MIGRATIONS[i - 1]!.name).toBe(true);
    }
  });

  it("creates a database, migrates, seeds owner and records rows", async () => {
    const world = fakeWorld();
    const admin = { id: "admin-1", ip: null };
    const { id } = await createTenant(pdb, {
      name: "Kandy Gold House", slug: "kandy-gold", ownerName: "Amara", ownerEmail: "o@x.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
      planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    const { d1Id, d1Name } = await provisionShop(env, pdb, { ...input, tenantId: id }, world.client);
    expect(d1Name.startsWith("goldos-kandy-gold-")).toBe(true);
    const raw = world.dbs.get(d1Id)!;
    // Migrations ran: exactly the three roles exist (owner, admin, staff).
    const roles = raw.prepare("SELECT COUNT(*) AS n FROM roles").get() as { n: number };
    expect(roles.n).toBe(3);
    // Owner seeded with lowercase email, HQ branch linked.
    const owner = raw.prepare("SELECT id, email FROM users WHERE email = ?").get("owner@kandygold.lk") as { id: string; email: string };
    expect(owner.email).toBe("owner@kandygold.lk");
    const grant = raw.prepare("SELECT role_id FROM user_roles WHERE user_id = ?").get(owner.id) as { role_id: string };
    expect(grant.role_id).toBe("owner");
    const branch = raw.prepare("SELECT id FROM branches WHERE code = 'MAIN'").get() as { id: string };
    expect(branch).toBeTruthy();
    // Control-plane rows.
    const link = await pdb.prepare("SELECT d1_id FROM tenant_databases WHERE tenant_id = ?").bind(id).first<{ d1_id: string }>();
    expect(link?.d1_id).toBe(d1Id);
    const member = await pdb.prepare("SELECT email FROM tenant_members WHERE tenant_id = ?").bind(id).first<{ email: string }>();
    expect(member?.email).toBe("owner@kandygold.lk");
  });

  it("retries the D1 name on clash", async () => {
    const world = fakeWorld({ clashFirstCreate: true });
    const admin = { id: "admin-1", ip: null };
    const { id } = await createTenant(pdb, {
      name: "Kandy Gold House", slug: "kandy-gold", ownerName: "Amara", ownerEmail: "o@x.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
      planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    const { d1Name } = await provisionShop(env, pdb, { ...input, tenantId: id }, world.client);
    const creates = world.calls.filter((c) => c.startsWith("create:"));
    expect(creates).toHaveLength(2);
    expect(creates[0]).not.toBe(creates[1]);
    expect(d1Name.startsWith("goldos-kandy-gold-")).toBe(true);
  });

  it("retry destroys the half-made database and provisions fresh", async () => {
    const world = fakeWorld();
    const admin = { id: "admin-1", ip: null };
    const { id } = await createTenant(pdb, {
      name: "Kandy Gold House", slug: "kandy-gold", ownerName: "Amara", ownerEmail: "o@x.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
      planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    // Failed provisions leave no mapping row: retry provisions straight through.
    const out = await retryProvision(env, pdb, id, { ownerEmail: "owner@kandygold.lk", tempPassword: "temporary-99" }, world.client);
    const owner = world.dbs.get(out.d1Id)!.prepare("SELECT email FROM users WHERE email = ?").get("owner@kandygold.lk") as { email: string };
    expect(owner.email).toBe("owner@kandygold.lk");
  });

  it("retry on a suspended shop destroys then recreates, in that order", async () => {
    const world = fakeWorld();
    const admin = { id: "admin-1", ip: null };
    const { id } = await createTenant(pdb, {
      name: "Kandy Gold House", slug: "kandy-gold", ownerName: "Amara", ownerEmail: "o@x.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
      planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    await pdb.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").bind(id, "d1-old", "goldos-kandy-gold-dead", 0).run();
    world.dbs.set("d1-old", new DatabaseSync(":memory:"));
    await suspendTenant(pdb, id, "repairing database", admin);
    const out = await retryProvision(env, pdb, id, { ownerEmail: "owner@kandygold.lk", tempPassword: "temporary-99" }, world.client);
    expect(out.d1Id).not.toBe("d1-old");
    const delIdx = world.calls.findIndex((c) => c === "delete:d1-old");
    const createIdx = world.calls.findIndex((c) => c.startsWith("create:goldos-kandy-gold-"));
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(delIdx);
  });

  it("retry refuses to wipe a live shop database", async () => {
    const world = fakeWorld();
    const admin = { id: "admin-1", ip: null };
    const { id } = await createTenant(pdb, {
      name: "Kandy Gold House", slug: "kandy-gold", ownerName: "Amara", ownerEmail: "o@x.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
      planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    await pdb.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").bind(id, "d1-live", "goldos-kandy-gold-live", 0).run();
    world.dbs.set("d1-live", new DatabaseSync(":memory:"));
    await expect(retryProvision(env, pdb, id, { ownerEmail: "owner@kandygold.lk", tempPassword: "temporary-99" }, world.client)).rejects.toThrow(/already has a database/i);
    expect(world.calls).toEqual([]);
    expect(world.dbs.has("d1-live")).toBe(true);
  });

  it("a failed control-plane write deletes the created database", async () => {
    const world = fakeWorld();
    const admin = { id: "admin-1", ip: null };
    const { id } = await createTenant(pdb, {
      name: "Kandy Gold House", slug: "kandy-gold", ownerName: "Amara", ownerEmail: "o@x.lk",
      country: "LK", currency: "LKR", timezone: "Asia/Colombo", region: "apac",
      planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    // A stale mapping row makes the final bookkeeping fail…
    await pdb.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").bind(id, "d1-stale", "goldos-stale", 0).run();
    await expect(provisionShop(env, pdb, { ...input, tenantId: id }, world.client)).rejects.toThrow();
    // …and the just-created database must not be left orphaned.
    expect(world.dbs.size).toBe(0);
  });

  it("builds a REST client from env secrets", () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, json: async () => ({ success: true, result: { uuid: "d1-x", name: "n" } }) } as Response;
    }) as unknown as typeof fetch;
    const client = restCfClient("acct-1", "tok-1", fetchFn);
    return client.createDatabase("goldos-x").then(() => {
      expect(seen[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database");
      expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    });
  });

  it("applies SQL through /query with a batch body", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, json: async () => ({ success: true, result: [{ success: true }] }) } as Response;
    }) as unknown as typeof fetch;
    const client = restCfClient("acct-1", "tok-1", fetchFn);
    await client.applySql("d1-x", [{ sql: "INSERT INTO a (id) VALUES (?)", params: ["1"] }]);
    expect(seen[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct-1/d1/database/d1-x/query");
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      batch: [{ sql: "INSERT INTO a (id) VALUES (?)", params: ["1"] }],
    });
  });
});
