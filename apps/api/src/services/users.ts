import type { CreateUserInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { hashPassword } from "./hash";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  is_active: number;
  created_at: number;
};

export async function createUser(
  db: D1Database,
  input: CreateUserInput,
  actorId: string
): Promise<{ id: string; email: string; name: string }> {
  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(input.email)
    .first<{ id: string }>();
  if (existing) throw Object.assign(new Error("Email already in use"), { code: "CONFLICT" });

  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first<{ id: string }>();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });

  const id = crypto.randomUUID();
  const now = Date.now();
  const passwordHash = await hashPassword(input.password);

  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id, email, name, password_hash, is_active, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
      )
      .bind(id, input.email, input.name, passwordHash, now, now, actorId),
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, input.role),
    db
      .prepare("INSERT INTO branch_members (user_id, branch_id) VALUES (?, ?)")
      .bind(id, input.branchId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "user.create",
      entity: "user",
      entityId: id,
      next: { email: input.email, name: input.name, role: input.role },
      branchId: input.branchId,
    }),
  ]);
  return { id, email: input.email, name: input.name };
}

export async function deactivateUser(
  db: D1Database,
  userId: string,
  actorId: string,
  reason: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, email, name, is_active FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; email: string; name: string; is_active: number }>();
  if (!prev) throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
  if (userId === actorId)
    throw Object.assign(new Error("Cannot deactivate yourself"), { code: "CONFLICT" });

  await db.batch([
    db.prepare("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?").bind(Date.now(), userId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "user.deactivate",
      entity: "user",
      entityId: userId,
      prev: { is_active: prev.is_active },
      next: { is_active: 0 },
      reason,
    }),
  ]);
}

export async function listUsers(
  db: D1Database,
  opts: { search?: string; page: number; limit: number }
): Promise<{ rows: UserRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const count = await db
    .prepare("SELECT COUNT(*) AS total FROM users WHERE email LIKE ? OR name LIKE ?")
    .bind(like, like)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      "SELECT id, email, name, is_active, created_at FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(like, like, opts.limit, offset)
    .all<UserRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function listRoles(db: D1Database): Promise<{ id: string; name: string; permissions: string[] }[]> {
  const { results: roleRows } = await db
    .prepare("SELECT id, name FROM roles ORDER BY name")
    .all<{ id: string; name: string }>();
  const { results: permRows } = await db
    .prepare(
      `SELECT rp.role_id AS role_id, p.name AS name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`
    )
    .all<{ role_id: string; name: string }>();
  const byRole = new Map<string, string[]>();
  for (const r of permRows ?? []) {
    const list = byRole.get(r.role_id) ?? [];
    list.push(r.name);
    byRole.set(r.role_id, list);
  }
  return (roleRows ?? []).map((r) => ({ id: r.id, name: r.name, permissions: byRole.get(r.id) ?? [] }));
}
