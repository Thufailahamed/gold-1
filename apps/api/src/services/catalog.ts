import type { CreateCategoryInput, CreatePurityInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";

export type CategoryRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: number;
  created_at: number;
};

export type PurityRow = {
  id: string;
  karat: string;
  purity: number;
  default_making_charge: number;
  default_wastage_pct: number;
  is_active: number;
  created_at: number;
};

export type PageOpts = { search?: string; page: number; limit: number };

async function paginate(
  db: D1Database,
  table: "categories" | "purities",
  cols: string,
  match: string,
  opts: PageOpts
): Promise<{ rows: never[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${match}`)
    .bind(like, like)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`SELECT ${cols} FROM ${table} WHERE ${match} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(like, like, opts.limit, offset)
    .all();
  return { rows: (results ?? []) as never[], total: count?.total ?? 0 };
}

export async function createCategory(
  db: D1Database,
  input: CreateCategoryInput,
  actorId: string
): Promise<CategoryRow> {
  const dup = await db
    .prepare("SELECT id FROM categories WHERE name = ? OR code = ?")
    .bind(input.name, input.code)
    .first<{ id: string }>();
  if (dup)
    throw Object.assign(new Error("Category name or code already in use"), { code: "CONFLICT" });
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO categories (id, name, code, description, is_active, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)"
      )
      .bind(id, input.name, input.code, input.description ?? null, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "category.create",
      entity: "category",
      entityId: id,
      next: input,
    }),
  ]);
  return {
    id,
    name: input.name,
    code: input.code,
    description: input.description ?? null,
    is_active: 1,
    created_at: now,
  };
}

export async function listCategories(
  db: D1Database,
  opts: PageOpts
): Promise<{ rows: CategoryRow[]; total: number }> {
  return paginate(
    db,
    "categories",
    "id, name, code, description, is_active, created_at",
    "name LIKE ? OR code LIKE ?",
    opts
  ) as Promise<{ rows: CategoryRow[]; total: number }>;
}

export async function deactivateCategory(
  db: D1Database,
  id: string,
  actorId: string,
  reason: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, is_active FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; is_active: number }>();
  if (!prev) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  await db.batch([
    db.prepare("UPDATE categories SET is_active = 0 WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "category.deactivate",
      entity: "category",
      entityId: id,
      prev: { is_active: prev.is_active },
      next: { is_active: 0 },
      reason,
    }),
  ]);
}

export async function createPurity(
  db: D1Database,
  input: CreatePurityInput,
  actorId: string
): Promise<PurityRow> {
  const dup = await db
    .prepare("SELECT id FROM purities WHERE karat = ?")
    .bind(input.karat)
    .first<{ id: string }>();
  if (dup) throw Object.assign(new Error("Karat already exists"), { code: "CONFLICT" });
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO purities (id, karat, purity, default_making_charge, default_wastage_pct, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
      )
      .bind(id, input.karat, input.purity, input.defaultMakingCharge, input.defaultWastagePct, now),
    buildAuditStmt(db, {
      userId: actorId,
      action: "purity.create",
      entity: "purity",
      entityId: id,
      next: input,
    }),
  ]);
  return {
    id,
    karat: input.karat,
    purity: input.purity,
    default_making_charge: input.defaultMakingCharge,
    default_wastage_pct: input.defaultWastagePct,
    is_active: 1,
    created_at: now,
  };
}

export async function listPurities(
  db: D1Database,
  opts: PageOpts
): Promise<{ rows: PurityRow[]; total: number }> {
  return paginate(
    db,
    "purities",
    "id, karat, purity, default_making_charge, default_wastage_pct, is_active, created_at",
    "karat LIKE ? OR karat LIKE ?",
    opts
  ) as Promise<{ rows: PurityRow[]; total: number }>;
}

export async function deactivatePurity(
  db: D1Database,
  id: string,
  actorId: string,
  reason: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, is_active FROM purities WHERE id = ?")
    .bind(id)
    .first<{ id: string; is_active: number }>();
  if (!prev) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
  await db.batch([
    db.prepare("UPDATE purities SET is_active = 0 WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "purity.deactivate",
      entity: "purity",
      entityId: id,
      prev: { is_active: prev.is_active },
      next: { is_active: 0 },
      reason,
    }),
  ]);
}
