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
  opts: PageOpts,
  orderBy = "created_at DESC"
): Promise<{ rows: never[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${match}`)
    .bind(like, like)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`SELECT ${cols} FROM ${table} WHERE ${match} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
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
    opts,
    // Alphabetical by name, ignoring case, so the list reads in order across pages.
    "name COLLATE NOCASE ASC"
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

/**
 * Renames a category and changes its code, keeping the same record, so the
 * products and history that point at it stay as they are. A name or code that
 * another category already uses is refused.
 */
export async function updateCategory(db: D1Database, id: string, input: CreateCategoryInput, actorId: string): Promise<void> {
  const prev = await db
    .prepare("SELECT id, name, code, description FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; code: string; description: string | null }>();
  if (!prev) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  const clash = await db
    .prepare("SELECT id FROM categories WHERE (name = ? OR code = ?) AND id <> ?")
    .bind(input.name, input.code, id)
    .first();
  if (clash) throw Object.assign(new Error("Category name or code already in use"), { code: "CONFLICT" });
  await db.batch([
    db
      .prepare("UPDATE categories SET name = ?, code = ?, description = ? WHERE id = ?")
      .bind(input.name, input.code, input.description ?? null, id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "category.update",
      entity: "category",
      entityId: id,
      prev: { name: prev.name, code: prev.code, description: prev.description },
      next: input,
    }),
  ]);
}

/** Turns a deactivated category back on, so products can be filed under it again. */
export async function reactivateCategory(db: D1Database, id: string, actorId: string): Promise<void> {
  const prev = await db
    .prepare("SELECT id, is_active FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; is_active: number }>();
  if (!prev) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  await db.batch([
    db.prepare("UPDATE categories SET is_active = 1 WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "category.reactivate",
      entity: "category",
      entityId: id,
      prev: { is_active: prev.is_active },
      next: { is_active: 1 },
    }),
  ]);
}

/**
 * Permanently removes a category, but only when nothing points at it: a
 * category that products, subcategories, purchase orders or manufacturing
 * outputs use stays, and the caller is told to deactivate it instead.
 */
export async function deleteCategory(db: D1Database, id: string, actorId: string): Promise<void> {
  const prev = await db
    .prepare("SELECT id, name, code FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; code: string }>();
  if (!prev) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  const uses = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM products WHERE category_id = ?1) AS products,
              (SELECT COUNT(*) FROM subcategories WHERE category_id = ?1) AS subcategories,
              (SELECT COUNT(*) FROM purchase_order_items WHERE category_id = ?1) AS purchase_items,
              (SELECT COUNT(*) FROM manufacturing_outputs WHERE category_id = ?1) AS manufacturing_outputs`
    )
    .bind(id)
    .first<{ products: number; subcategories: number; purchase_items: number; manufacturing_outputs: number }>();
  const inUse = uses ? uses.products + uses.subcategories + uses.purchase_items + uses.manufacturing_outputs : 0;
  if (inUse > 0)
    throw Object.assign(
      new Error(
        `${prev.name} is used by ${uses!.products} piece${uses!.products === 1 ? "" : "s"} and ${inUse - uses!.products} other record${inUse - uses!.products === 1 ? "" : "s"}. Deactivate it instead.`
      ),
      { code: "CONFLICT" }
    );
  await db.batch([
    db.prepare("DELETE FROM categories WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "category.delete",
      entity: "category",
      entityId: id,
      prev: { name: prev.name, code: prev.code },
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
