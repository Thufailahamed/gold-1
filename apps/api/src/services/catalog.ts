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
  permille: number;
  default_making_cents: number;
  default_wastage_mg: number;
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
        "INSERT INTO purities (id, karat, permille, default_making_cents, default_wastage_mg, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
      )
      .bind(
        id,
        input.karat,
        input.permille,
        Math.round(input.defaultMakingLkr * 100),
        Math.round(input.defaultWastageMg),
        now
      ),
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
    permille: input.permille,
    default_making_cents: input.defaultMakingLkr,
    default_wastage_mg: input.defaultWastageMg,
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
    "id, karat, permille, default_making_cents, default_wastage_mg, is_active, created_at",
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

export type SimpleRow = {
  id: string;
  name: string;
  code: string;
  is_active: number;
  created_at: number;
};

async function createSimple(
  db: D1Database,
  table: string,
  entity: string,
  input: { name: string; code: string; categoryId?: string },
  actorId: string
): Promise<SimpleRow> {
  const dup = await db
    .prepare(`SELECT id FROM ${table} WHERE code = ?`)
    .bind(input.code)
    .first();
  if (dup) throw Object.assign(new Error("Code already in use"), { code: "CONFLICT" });
  if (table === "subcategories") {
    const cat = await db
      .prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1")
      .bind(input.categoryId)
      .first();
    if (!cat) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const extraCols = table === "subcategories" ? ", category_id" : "";
  const extraVals = table === "subcategories" ? [input.categoryId] : [];
  await db.batch([
    db
      .prepare(
        `INSERT INTO ${table} (id, name, code${extraCols}, is_active, created_at, created_by) VALUES (?, ?, ?${extraCols ? ", ?" : ""}, 1, ?, ?)`
      )
      .bind(id, input.name, input.code, ...extraVals, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: `${entity}.create`,
      entity,
      entityId: id,
      next: input,
    }),
  ]);
  return { id, name: input.name, code: input.code, is_active: 1, created_at: now };
}

async function listSimple(
  db: D1Database,
  table: string,
  categoryId: string | undefined,
  opts: PageOpts
): Promise<{ rows: SimpleRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const extra = table === "subcategories" && categoryId ? "AND category_id = ?" : "";
  const base = table === "subcategories" && categoryId ? [like, like, categoryId] : [like, like];
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE (name LIKE ? OR code LIKE ?) ${extra}`)
    .bind(...base)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT id, name, code, is_active, created_at FROM ${table} WHERE (name LIKE ? OR code LIKE ?) ${extra} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...base, opts.limit, offset)
    .all<SimpleRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export const createSubcategory = (
  db: D1Database,
  input: { categoryId: string; name: string; code: string },
  actorId: string
) => createSimple(db, "subcategories", "subcategory", input, actorId);
export const createDesign = (db: D1Database, input: { name: string; code: string }, actorId: string) =>
  createSimple(db, "designs", "design", input, actorId);
export const createProductType = (
  db: D1Database,
  input: { name: string; code: string },
  actorId: string
) => createSimple(db, "product_types", "product_type", input, actorId);
export const createMetalType = (
  db: D1Database,
  input: { name: string; code: string },
  actorId: string
) => createSimple(db, "metal_types", "metal_type", input, actorId);
export const createStoneType = (
  db: D1Database,
  input: { name: string; code: string },
  actorId: string
) => createSimple(db, "stone_types", "stone_type", input, actorId);
export const listSubcategories = (db: D1Database, categoryId: string | undefined, opts: PageOpts) =>
  listSimple(db, "subcategories", categoryId, opts);
export const listDesigns = (db: D1Database, opts: PageOpts) => listSimple(db, "designs", undefined, opts);
export const listProductTypes = (db: D1Database, opts: PageOpts) =>
  listSimple(db, "product_types", undefined, opts);
export const listMetalTypes = (db: D1Database, opts: PageOpts) =>
  listSimple(db, "metal_types", undefined, opts);
export const listStoneTypes = (db: D1Database, opts: PageOpts) =>
  listSimple(db, "stone_types", undefined, opts);
