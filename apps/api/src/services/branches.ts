import { buildAuditStmt } from "../middleware/audit";

export type BranchRow = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  is_active: number;
  created_at: number;
};

export async function createBranch(
  db: D1Database,
  input: { name: string; code: string; address?: string },
  actorId: string
): Promise<BranchRow> {
  const existing = await db
    .prepare("SELECT id FROM branches WHERE code = ?")
    .bind(input.code)
    .first<{ id: string }>();
  if (existing) throw Object.assign(new Error("Branch code already in use"), { code: "CONFLICT" });

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO branches (id, name, code, address, is_active, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)"
      )
      .bind(id, input.name, input.code, input.address ?? null, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "branch.create",
      entity: "branch",
      entityId: id,
      next: input,
      branchId: id,
    }),
  ]);
  return { id, name: input.name, code: input.code, address: input.address ?? null, is_active: 1, created_at: now };
}

export async function listBranches(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: { search?: string; page: number; limit: number }
): Promise<{ rows: BranchRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const scope = canManageAll ? "" : "AND b.id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)";
  const countBind = canManageAll ? [like, like] : [like, like, userId];
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM branches b WHERE (b.name LIKE ? OR b.code LIKE ?) ${scope}`)
    .bind(...countBind)
    .first<{ total: number }>();
  const rowBind = canManageAll ? [like, like, opts.limit, offset] : [like, like, userId, opts.limit, offset];
  const { results } = await db
    .prepare(
      `SELECT b.id, b.name, b.code, b.address, b.is_active, b.created_at FROM branches b WHERE (b.name LIKE ? OR b.code LIKE ?) ${scope} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...rowBind)
    .all<BranchRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function updateBranch(
  db: D1Database,
  branchId: string,
  patch: { name?: string; address?: string; isActive?: number },
  actorId: string,
  reason?: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, name, address, is_active FROM branches WHERE id = ?")
    .bind(branchId)
    .first<{ id: string; name: string; address: string | null; is_active: number }>();
  if (!prev) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.address !== undefined) {
    sets.push("address = ?");
    vals.push(patch.address);
  }
  if (patch.isActive !== undefined) {
    sets.push("is_active = ?");
    vals.push(patch.isActive);
  }
  if (sets.length === 0) return;

  await db.batch([
    db.prepare(`UPDATE branches SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, branchId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "branch.update",
      entity: "branch",
      entityId: branchId,
      prev,
      next: patch,
      reason,
      branchId,
    }),
  ]);
}
