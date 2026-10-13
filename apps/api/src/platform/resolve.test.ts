import { describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "../services/sqlite-test-db";
import type { Env } from "../db/client";
import { extractTenantSlug, resolveShopDb, TENANT_COOKIE, TenantResolveError } from "./resolve";

function platformWithTenant(opts: { slug: string; status?: string; d1Id?: string; reason?: string }) {
  const pdb = migratedDb("drizzle-platform");
  const now = 0;
  pdb.raw
    .prepare(
      "INSERT INTO tenants (id, slug, name, owner_name, owner_email, status, suspended_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(`t-${opts.slug}`, opts.slug, opts.slug, "Owner", "o@x.lk", opts.status ?? "ACTIVE", opts.reason ?? null, now, now);
  if (opts.d1Id) {
    pdb.raw
      .prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)")
      .run(`t-${opts.slug}`, opts.d1Id, `goldos-${opts.slug}`, now);
  }
  return pdb;
}

describe.skipIf(!sqliteAvailable)("tenant resolution", () => {
  it("returns the shop database for a slug", async () => {
    const pdb = platformWithTenant({ slug: "kandy-gold", d1Id: "d1-kandy" });
    const shopA = migratedDb();
    const shopB = migratedDb();
    const env = {
      DB: shopB.db,
      PLATFORM_DB: pdb.db,
      R2: {} as R2Bucket,
      TEST_HANDLES: { "d1-kandy": shopA.db },
    } as unknown as Env;
    const { db, tenant } = await resolveShopDb(env, "kandy-gold");
    expect(tenant).toMatchObject({ slug: "kandy-gold", status: "ACTIVE" });
    // The resolved handle is shop A, not the legacy default.
    await db.prepare("INSERT INTO branches (id, name, code, is_active, created_at) VALUES ('x', 'X', 'X', 1, 0)").run();
    const inA = shopA.raw.prepare("SELECT id FROM branches WHERE id = 'x'").get();
    expect(inA).toBeTruthy();
    expect(shopB.raw.prepare("SELECT id FROM branches WHERE id = 'x'").get()).toBeFalsy();
  });

  it("answers 503 while an account has no provisioned database", async () => {
    const pdb = platformWithTenant({ slug: "fresh-shop" });
    const env = { DB: migratedDb().db, PLATFORM_DB: pdb.db, R2: {} as R2Bucket } as unknown as Env;
    const err = await resolveShopDb(env, "fresh-shop").catch((e) => e);
    expect(err).toBeInstanceOf(TenantResolveError);
    expect(err.status).toBe(503);
  });

  it("refuses a suspended workspace with 403", async () => {
    const pdb = platformWithTenant({ slug: "bad-shop", status: "SUSPENDED", d1Id: "d1-bad", reason: "Abuse" });
    const env = {
      DB: migratedDb().db,
      PLATFORM_DB: pdb.db,
      R2: {} as R2Bucket,
      TEST_HANDLES: { "d1-bad": migratedDb().db },
    } as unknown as Env;
    const err = await resolveShopDb(env, "bad-shop").catch((e) => e);
    expect(err).toBeInstanceOf(TenantResolveError);
    expect(err.status).toBe(403);
  });

  it("prefers the tenant cookie over the header", () => {
    const c = {
      req: {
        header: (n: string) =>
          n === "cookie" ? `${TENANT_COOKIE}=cookie-shop; session=abc` : n === "x-shop-slug" ? "header-shop" : undefined,
        query: () => undefined,
      },
    };
    expect(TENANT_COOKIE).toBe("goldos_tenant");
    expect(extractTenantSlug(c)).toBe("cookie-shop");
  });
});
