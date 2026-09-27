/**
 * Seed script: roles + permissions + first admin user.
 *
 * Usage:
 *   1. Generate a scrypt hash for the admin password:
 *      pnpm --filter goldos-api exec tsx scripts/hash-password.ts 'YourStrongPassword'
 *   2. Fill ADMIN_* below (or via env when generating seed.sql).
 *   3. Run: wrangler d1 execute DB --local --file ./drizzle/seed.sql
 *
 * Never commit plaintext passwords. seed.sql is git-ignored.
 */

export const SEED_ROLES = ["admin", "manager", "cashier", "viewer"] as const;

export const SEED_PERMISSIONS = [
  "users:read",
  "users:write",
  "branches:manage",
  "settings:write",
  "audit:read",
  "masters:read",
  "masters:write",
] as const;

export const SEED_ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ["users:read", "users:write", "branches:manage", "settings:write", "audit:read", "masters:read", "masters:write"],
  manager: ["users:read", "branches:manage", "audit:read", "masters:read", "masters:write"],
  cashier: ["users:read", "masters:read"],
  viewer: [],
};

export function buildSeedSql(opts: {
  adminId: string;
  adminEmail: string;
  adminName: string;
  adminPasswordHash: string;
  branchId: string;
}): string {
  const now = Date.now();
  const lines: string[] = [];
  for (const r of SEED_ROLES) lines.push(`INSERT INTO roles (id, name) VALUES ('${r}', '${r}');`);
  for (const p of SEED_PERMISSIONS)
    lines.push(`INSERT INTO permissions (id, name) VALUES ('${p}', '${p}');`);
  for (const [role, perms] of Object.entries(SEED_ROLE_PERMISSIONS))
    for (const p of perms)
      lines.push(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('${role}', '${p}');`
      );
  lines.push(
    `INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at) VALUES ('${opts.adminId}', '${opts.adminEmail}', '${opts.adminName}', '${opts.adminPasswordHash}', 1, ${now}, ${now});`
  );
  lines.push(`INSERT INTO user_roles (user_id, role_id) VALUES ('${opts.adminId}', 'admin');`);
  lines.push(
    `INSERT INTO branches (id, name, code, is_active, created_at, created_by) VALUES ('${opts.branchId}', 'Main Branch', 'MAIN', 1, ${now}, '${opts.adminId}');`
  );
  lines.push(
    `INSERT INTO branch_members (user_id, branch_id) VALUES ('${opts.adminId}', '${opts.branchId}');`
  );
  return lines.join("\n") + "\n";
}
