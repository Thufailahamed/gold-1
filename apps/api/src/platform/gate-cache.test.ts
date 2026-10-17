import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { migratedDb, sqliteAvailable } from "../services/sqlite-test-db";
import type { Env } from "../db/client";
import { resetGateCache, tenantGate } from "./bridge";

describe.skipIf(!sqliteAvailable)("tenant gate cache", () => {
  let queries: number;
  let env: Env;

  beforeEach(() => {
    const pdb = migratedDb("drizzle-platform");
    for (const id of ["t1", "t2"])
      pdb.raw.prepare("INSERT INTO tenants (id, slug, name, owner_name, owner_email, created_at, updated_at) VALUES (?, ?, ?, 'O', 'o@x.lk', 0, 0)").run(id, id, id);
    queries = 0;
    const counted = new Proxy(pdb.db, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (prop === "prepare") return (sql: string) => {
          if (/FROM tenants/i.test(sql)) queries++;
          return (v as (s: string) => unknown).call(target, sql);
        };
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    env = { PLATFORM_DB: counted as D1Database } as unknown as Env;
    resetGateCache();
  });

  function app(tenantId: string) {
    const a = new Hono<{ Bindings: Env; Variables: { tenantId?: string } }>();
    a.use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      await next();
    });
    a.use("*", tenantGate);
    a.get("/api/v1/x", (c) => c.json({ ok: true }));
    return a;
  }

  it("does not evict one shop's entry when another shop makes a request", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await app("t1").request("/api/v1/x", {}, env)).status).toBe(200);
      expect((await app("t2").request("/api/v1/x", {}, env)).status).toBe(200);
    }
    // Each shop's status was read once, not once per alternating request.
    expect(queries).toBe(2);
  });
});
