import { beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import type { Env } from "../db/client";
import { SHOP_MIGRATIONS } from "../db/shop-migrations";
import { LATEST_MIGRATION, SCHEMA_MIGRATIONS_DDL, type CfClient, type CfQuery } from "./provision";
import { createTenant } from "./services/tenants";
import { appliedMigrations, fleetStatus, planShopMigration, runFleetMigrations } from "./services/fleet";

const require = createRequire(import.meta.url);
const DatabaseSync = require("node:sqlite").DatabaseSync as new (path: string) => SqliteDb;

function fill(sql: string, params: unknown[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

/** Behaves like D1: constraints enforced, an atomic batch is one transaction. */
function clientOver(shops: Record<string, SqliteDb>, calls: string[] = []): CfClient {
  return {
    async createDatabase() {
      throw new Error("not used");
    },
    async deleteDatabase() {},
    async applySql(d1Id: string, queries: CfQuery[], opts?: { atomic?: boolean }) {
      calls.push(d1Id);
      const raw = shops[d1Id]!;
      raw.exec("PRAGMA foreign_keys = ON");
      raw.exec("BEGIN");
      if (opts?.atomic) raw.exec("PRAGMA defer_foreign_keys = on");
      try {
        for (const q of queries) raw.exec(fill(q.sql, q.params ?? []));
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

describe.skipIf(!sqliteAvailable)("fleet migrations", () => {
  let pdb: { db: D1Database; raw: SqliteDb };
  let env: Env;
  const handles: Record<string, D1Database> = {};
  const raws: Record<string, SqliteDb> = {};
  const admin = { id: "admin-1", ip: null };

  async function shop(slug: string, d1Id: string, setup?: (raw: SqliteDb) => void) {
    const t = await createTenant(pdb.db, {
      name: slug, slug, ownerName: "O", ownerEmail: `o@${slug}.lk`, country: "LK", currency: "LKR",
      timezone: "Asia/Colombo", region: "apac", planId: "plan-starter", interval: "MONTH", tags: [],
    }, admin);
    const m = migratedDb();
    setup?.(m.raw);
    handles[d1Id] = m.db;
    raws[d1Id] = m.raw;
    await pdb.db.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, 0)").bind(t.id, d1Id, `goldos-${slug}`).run();
    return t.id;
  }

  beforeEach(() => {
    pdb = migratedDb("drizzle-platform");
    for (const k of Object.keys(handles)) delete handles[k];
    for (const k of Object.keys(raws)) delete raws[k];
    env = { DB: migratedDb().db, PLATFORM_DB: pdb.db, R2: {} as R2Bucket, TEST_HANDLES: handles } as unknown as Env;
  });

  it("adopts a shop that predates tracking at the baseline without re-running migrations", async () => {
    const id = await shop("old-shop", "d1-old");
    const calls: string[] = [];
    const r = await runFleetMigrations(env, pdb.db, { client: clientOver(raws, calls) });
    expect(r).toMatchObject({ shops: 1, migrated: 1, failed: 0 });
    const applied = await appliedMigrations(handles["d1-old"]!);
    expect(applied?.has(LATEST_MIGRATION)).toBe(true);
    expect(applied?.size).toBe(SHOP_MIGRATIONS.length);
    const row = await pdb.db.prepare("SELECT schema_version, schema_error FROM tenant_databases WHERE tenant_id = ?").bind(id).first<{ schema_version: string; schema_error: string | null }>();
    expect(row).toEqual({ schema_version: LATEST_MIGRATION, schema_error: null });
    // Second run is a no-op that sends nothing to the shop.
    calls.length = 0;
    const again = await runFleetMigrations(env, pdb.db, { client: clientOver(raws, calls) });
    expect(again).toMatchObject({ upToDate: 1, migrated: 0 });
    expect(calls).toEqual([]);
  });

  it("applies a new migration to every shop, atomically, in order", async () => {
    await shop("a-shop", "d1-a");
    await shop("b-shop", "d1-b");
    const client = clientOver(raws);
    await runFleetMigrations(env, pdb.db, { client });
    const next = { name: "9001_add_note.sql", sql: "ALTER TABLE branches ADD COLUMN fleet_note TEXT;\nUPDATE branches SET fleet_note = 'x';" };
    const r = await runFleetMigrations(env, pdb.db, { client, migrations: [...SHOP_MIGRATIONS, next] });
    expect(r).toMatchObject({ shops: 2, migrated: 2, failed: 0, latest: "9001_add_note.sql" });
    for (const id of ["d1-a", "d1-b"]) {
      const cols = raws[id]!.prepare("PRAGMA table_info(branches)").all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === "fleet_note")).toBe(true);
      expect((await appliedMigrations(handles[id]!))?.has("9001_add_note.sql")).toBe(true);
    }
    const status = await fleetStatus(pdb.db);
    expect(status.total).toBe(2);
  });

  it("rolls a shop back when its migration fails and keeps going with the rest", async () => {
    await shop("bad-shop", "d1-bad");
    await shop("good-shop", "d1-good");
    const client = clientOver(raws);
    await runFleetMigrations(env, pdb.db, { client });
    // Break only the first shop: the new migration's column already exists there.
    raws["d1-bad"]!.exec("ALTER TABLE branches ADD COLUMN fleet_note TEXT");
    const next = { name: "9001_add_note.sql", sql: "UPDATE branches SET code = code;\nALTER TABLE branches ADD COLUMN fleet_note TEXT;" };
    const r = await runFleetMigrations(env, pdb.db, { client, migrations: [...SHOP_MIGRATIONS, next] });
    expect(r).toMatchObject({ migrated: 1, failed: 1 });
    expect((await appliedMigrations(handles["d1-bad"]!))?.has("9001_add_note.sql")).toBe(false);
    expect((await appliedMigrations(handles["d1-good"]!))?.has("9001_add_note.sql")).toBe(true);
    const bad = await pdb.db.prepare("SELECT schema_error FROM tenant_databases WHERE d1_id = 'd1-bad'").first<{ schema_error: string | null }>();
    expect(bad?.schema_error).toMatch(/duplicate column/i);
  });

  it("reports shops it cannot reach and skips archived accounts", async () => {
    await shop("lost-shop", "d1-lost");
    delete handles["d1-lost"];
    const r = await runFleetMigrations(env, pdb.db, { client: clientOver(raws) });
    expect(r).toMatchObject({ unreachable: 1, migrated: 0 });
  });

  it("plans nothing for a fully applied shop", () => {
    const all = new Set(SHOP_MIGRATIONS.map((m) => m.name));
    expect(planShopMigration(all).pending).toEqual([]);
    expect(planShopMigration(null).pending).toEqual([]);
    expect(planShopMigration(null).queries[0]!.sql).toBe(SCHEMA_MIGRATIONS_DDL);
  });
});
