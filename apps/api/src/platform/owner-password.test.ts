import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../services/sqlite-test-db";
import { verifyPassword } from "../services/hash";
import type { Env } from "../db/client";
import { setOwnerPassword } from "./services/ops";

const admin = { id: "admin-1", ip: null };

describe.skipIf(!sqliteAvailable)("staff owner password reset", () => {
  let pdb: { db: D1Database; raw: SqliteDb };
  let shop: { db: D1Database; raw: SqliteDb };
  let env: Env;

  beforeEach(() => {
    pdb = migratedDb("drizzle-platform");
    shop = migratedDb();
    const now = Date.now();
    pdb.raw.prepare(
      "INSERT INTO platform_admins (id, email, name, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 'super_admin', 1, ?, ?)"
    ).run(admin.id, "a@goldos.lk", "Admin", "x", now, now);
    pdb.raw.prepare(
      "INSERT INTO tenants (id, slug, name, owner_name, owner_email, status, created_at, updated_at) VALUES ('t-1', 'kandy', 'Kandy', 'Owner', 'Owner@Kandy.lk', 'ACTIVE', ?, ?)"
    ).run(now, now);
    pdb.raw.prepare("INSERT INTO tenant_databases (tenant_id, d1_id, d1_name, created_at) VALUES ('t-1', 'd1-k', 'goldos-kandy', ?)").run(now);
    shop.raw.prepare("INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES ('u-o', 'owner@kandy.lk', 'Owner', 'old', 1, ?, ?)").run(now, now);
    shop.raw.prepare("INSERT INTO user_roles (user_id, role_id) VALUES ('u-o', 'owner')").run();
    shop.raw.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s-1', 'u-o', ?, ?)").run(now + 3600_000, now);
    shop.raw.prepare("INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES ('email:owner@kandy.lk', 9, ?, ?)").run(now, now + 3600_000);
    env = { PLATFORM_DB: pdb.db, TEST_HANDLES: { "d1-k": shop.db } } as unknown as Env;
  });

  it("rehashes the owner, signs them out, lifts the lockout and audits without the password", async () => {
    await expect(setOwnerPassword(pdb.db, env, "t-1", { password: "new-pass-123", reason: "owner locked out" }, admin)).resolves.toEqual({ email: "owner@kandy.lk" });
    const u = shop.raw.prepare("SELECT password_hash FROM users WHERE id = 'u-o'").get() as { password_hash: string };
    expect(await verifyPassword("new-pass-123", u.password_hash)).toBe(true);
    expect(shop.raw.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(shop.raw.prepare("SELECT COUNT(*) AS n FROM login_attempts").get()).toEqual({ n: 0 });
    const audit = pdb.raw.prepare("SELECT action, new_json, reason FROM platform_audit_logs WHERE tenant_id = 't-1'").get() as { action: string; new_json: string; reason: string };
    expect(audit.action).toBe("tenant.owner_password_reset");
    expect(audit.reason).toBe("owner locked out");
    expect(audit.new_json).not.toContain("new-pass-123");
  });

  it("refuses when the shop has no active owner with that email", async () => {
    shop.raw.prepare("UPDATE users SET is_active = 0").run();
    await expect(setOwnerPassword(pdb.db, env, "t-1", { password: "new-pass-123", reason: "reset" }, admin)).rejects.toThrow(/No active owner/);
  });

  it("refuses an account without a shop database", async () => {
    pdb.raw.prepare("DELETE FROM tenant_databases").run();
    await expect(setOwnerPassword(pdb.db, env, "t-1", { password: "new-pass-123", reason: "reset" }, admin)).rejects.toThrow(/no shop database/);
  });
});
