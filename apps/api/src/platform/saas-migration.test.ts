import { describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "../services/sqlite-test-db";

describe.skipIf(!sqliteAvailable)("saas control-plane migration 0002", () => {
  it("creates tenant_databases, tenant_members and tenant_receipts", async () => {
    const { raw } = migratedDb("drizzle-platform");
    const tables = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tenant_databases', 'tenant_members', 'tenant_receipts')"
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(["tenant_databases", "tenant_members", "tenant_receipts"]);

    // Enforcement of reserved slugs lives in the app, not the database:
    // a blocklisted slug must still insert at the DB level.
    raw.prepare("INSERT INTO tenants (id, slug, name, owner_name, owner_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "t-admin", "admin", "Admin Shop", "Root", "root@goldos.lk", 0, 0
    );
    const found = raw.prepare("SELECT slug FROM tenants WHERE id = ?").get("t-admin") as { slug: string };
    expect(found.slug).toBe("admin");

    // One shop maps to one D1 id.
    raw.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").run(
      "t-admin", "d1-abc", "goldos-admin-x1", 0
    );
    await expect(async () => {
      raw.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES (?, ?, ?, ?)").run(
        "t-admin", "d1-abc", "goldos-admin-x2", 0
      );
    }).rejects.toThrow();

    // Receipts reject statuses outside the lifecycle at the DB level.
    await expect(async () => {
      raw.prepare(
        "INSERT INTO tenant_receipts (id, tenant_id, invoice_id, r2_key, amount_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("r-1", "t-admin", "inv-1", "receipts/t-admin/r-1", 100, "BOGUS", 0);
    }).rejects.toThrow();
  });
});
