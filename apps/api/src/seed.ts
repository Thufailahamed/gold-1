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

export const SEED_ROLES = ["owner", "admin", "staff"] as const;

export const SEED_PERMISSIONS = [
  "users:view",
  "users:create",
  "users:edit",
  "users:approve",
  "users:cancel",
  "users:export",
  "roles:view",
  "roles:manage",
  "branches:view",
  "branches:create",
  "branches:edit",
  "branches:approve",
  "branches:manage",
  "settings:view",
  "settings:edit",
  "settings:manage",
  "audit:view",
  "audit:export",
  "masters:view",
  "masters:create",
  "masters:edit",
  "masters:cancel",
  "masters:export",
  "products:view",
  "products:create",
  "products:edit",
  "products:cancel",
  "products:export",
  "accounts:view",
  "accounts:manage",
  "purchases:view",
  "purchases:create",
  "purchases:edit",
  "purchases:cancel",
  "purchases:export",
  "sales:view",
  "sales:create",
  "sales:edit",
  "sales:cancel",
  "sales:export",
  "sales:approve",
  "oldgold:view",
  "oldgold:create",
  "oldgold:edit",
  "oldgold:cancel",
  "oldgold:export",
  "oldgold:approve",
  "gold:view",
  "gold:manage",
  "mfg:view",
  "mfg:create",
  "mfg:edit",
  "mfg:approve",
  "dayclose:view",
  "dayclose:manage",
] as const;

export const SEED_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: [...SEED_PERMISSIONS],
  admin: (SEED_PERMISSIONS as readonly string[]).filter(
    (p) =>
      p !== "accounts:view" &&
      p !== "accounts:manage" &&
      p !== "users:approve" &&
      p !== "branches:approve" &&
      p !== "roles:manage"
  ),
  staff: [
    "branches:view",
    "masters:view",
    "products:view",
    "purchases:view",
    "sales:view",
    "sales:create",
    "oldgold:view",
    "oldgold:create",
    "gold:view",
    "dayclose:view",
    "dayclose:manage",
  ],
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
  lines.push(`INSERT INTO user_roles (user_id, role_id) VALUES ('${opts.adminId}', 'owner');`);
  lines.push(
    `INSERT INTO branches (id, name, code, is_active, created_at, created_by) VALUES ('${opts.branchId}', 'Main Branch', 'MAIN', 1, ${now}, '${opts.adminId}');`
  );
  lines.push(
    `INSERT INTO branch_members (user_id, branch_id) VALUES ('${opts.adminId}', '${opts.branchId}');`
  );
  return lines.join("\n") + "\n";
}
