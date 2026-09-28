import {
  BARCODE_RE,
  fineGoldMg,
  gToMg,
  lkrToCents,
  priceCents,
  type CreateProductInput,
  type EditProductInput,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRatesCents } from "./rates";
import { consumeApproval, pendingApproval, requestApproval } from "./approvals";
import { postGoldStmts } from "./gold";

export type ProductRow = {
  id: string;
  barcode: string;
  sku: string;
  category_id: string;
  category_name: string;
  subcategory_id: string | null;
  design_id: string | null;
  product_type_id: string | null;
  metal_type_id: string;
  metal_name: string;
  stone_type_id: string | null;
  purity_id: string;
  karat: string;
  permille: number;
  name: string;
  gross_mg: number;
  stone_mg: number;
  net_mg: number;
  fine_gold_mg: number;
  making_cents: number;
  wastage_mg: number;
  cost_cents: number | null;
  selling_price_cents: number | null;
  location: string | null;
  notes: string | null;
  image_keys: string[];
  status: string;
  branch_id: string;
  created_at: number;
};

export type LivePrice = {
  amount_cents: number;
  rate_cents_per_g: number;
  rate_effective_from: number;
} | null;

export type ProductDetail = { product: ProductRow; livePrice: LivePrice; noRate: boolean };

type RawRow = Omit<ProductRow, "image_keys"> & { image_keys: string };

const WITH_NAMES =
  "SELECT p.id, p.barcode, p.sku, p.category_id, c.name AS category_name, p.subcategory_id, p.design_id, p.product_type_id, p.metal_type_id, m.name AS metal_name, p.stone_type_id, p.purity_id, pu.karat, pu.permille, p.name, p.gross_mg, p.stone_mg, p.net_mg, p.fine_gold_mg, p.making_cents, p.wastage_mg, p.cost_cents, p.selling_price_cents, p.location, p.notes, p.image_keys, p.status, p.branch_id, p.created_at FROM products p JOIN categories c ON c.id = p.category_id JOIN metal_types m ON m.id = p.metal_type_id JOIN purities pu ON pu.id = p.purity_id";

function parseRow(r: RawRow): ProductRow {
  return { ...r, image_keys: JSON.parse(r.image_keys) as string[] };
}

const BARCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(prefix: "JW-" | "SKU-"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = prefix;
  for (const b of bytes) s += BARCODE_ALPHABET[b % BARCODE_ALPHABET.length];
  return s;
}

async function uniqueCode(
  db: D1Database,
  column: "barcode" | "sku",
  prefix: "JW-" | "SKU-"
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomCode(prefix);
    if (prefix === "JW-" && !BARCODE_RE.test(candidate)) continue;
    const dup = await db
      .prepare(`SELECT id FROM products WHERE ${column} = ?`)
      .bind(candidate)
      .first();
    if (!dup) return candidate;
  }
  throw Object.assign(new Error("Could not generate unique code"), { code: "INTERNAL" });
}

async function checkRef(db: D1Database, table: string, id: string, label: string): Promise<void> {
  const row = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ? AND is_active = 1`)
    .bind(id)
    .first();
  if (!row) throw Object.assign(new Error(`${label} not found or inactive`), { code: "NOT_FOUND" });
}

export async function priceFor(
  db: D1Database,
  purityId: string,
  netMg: number,
  makingCents: number
): Promise<{ livePrice: LivePrice; noRate: boolean }> {
  const rates = await currentGoldRatesCents(db);
  const rate = rates.find((r) => r.purity_id === purityId);
  if (!rate) return { livePrice: null, noRate: true };
  return {
    livePrice: {
      amount_cents: priceCents(netMg, rate.rate_cents_per_g, makingCents),
      rate_cents_per_g: rate.rate_cents_per_g,
      rate_effective_from: rate.effective_from,
    },
    noRate: false,
  };
}

export type BuiltProduct = {
  stmts: D1PreparedStatement[];
  id: string;
  barcode: string;
  sku: string;
  netMg: number;
};

export async function buildCreateProductStmts(
  db: D1Database,
  input: CreateProductInput,
  actorId: string,
  branchId: string,
  now: number
): Promise<BuiltProduct> {
  await checkRef(db, "categories", input.categoryId, "Category");
  if (input.subcategoryId) await checkRef(db, "subcategories", input.subcategoryId, "Subcategory");
  if (input.designId) await checkRef(db, "designs", input.designId, "Design");
  if (input.productTypeId) await checkRef(db, "product_types", input.productTypeId, "Product type");
  await checkRef(db, "metal_types", input.metalTypeId, "Metal type");
  if (input.stoneTypeId) await checkRef(db, "stone_types", input.stoneTypeId, "Stone type");
  await checkRef(db, "purities", input.purityId, "Purity");
  const grossMg = gToMg(input.grossG);
  const stoneMg = gToMg(input.stoneG);
  const netMg = grossMg - stoneMg;
  if (netMg <= 0)
    throw Object.assign(new Error("Stone weight must be less than gross weight"), {
      code: "VALIDATION",
    });
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const purity = await db
    .prepare("SELECT permille FROM purities WHERE id = ?")
    .bind(input.purityId)
    .first<{ permille: number }>();
  if (!purity) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
  const barcode = await uniqueCode(db, "barcode", "JW-");
  const sku = await uniqueCode(db, "sku", "SKU-");
  const makingCents = lkrToCents(input.makingLkr);
  const id = crypto.randomUUID();
  const stmts = [
    db
      .prepare(
        "INSERT INTO products (id, barcode, sku, category_id, subcategory_id, design_id, product_type_id, metal_type_id, stone_type_id, purity_id, name, gross_mg, stone_mg, net_mg, fine_gold_mg, making_cents, wastage_mg, cost_cents, selling_price_cents, location, notes, image_keys, status, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?, ?, ?)"
      )
      .bind(
        id,
        barcode,
        sku,
        input.categoryId,
        input.subcategoryId ?? null,
        input.designId ?? null,
        input.productTypeId ?? null,
        input.metalTypeId,
        input.stoneTypeId ?? null,
        input.purityId,
        input.name,
        grossMg,
        stoneMg,
        netMg,
        fineGoldMg(netMg, purity.permille),
        makingCents,
        gToMg(input.wastageG),
        input.costLkr !== undefined ? lkrToCents(input.costLkr) : null,
        input.sellingPriceLkr !== undefined ? lkrToCents(input.sellingPriceLkr) : null,
        input.location ?? null,
        input.notes ?? null,
        "[]",
        branchId,
        now,
        actorId
      ),
    db
      .prepare(
        "INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'INTAKE', NULL, 'IN_STOCK', NULL, ?, ?, 'intake', ?, ?)"
      )
      .bind(crypto.randomUUID(), id, branchId, netMg, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "product.create",
      entity: "product",
      entityId: id,
      next: { ...input, barcode, sku },
      branchId,
    }),
  ];
  return { stmts, id, barcode, sku, netMg };
}

export async function createProduct(
  db: D1Database,
  input: CreateProductInput,
  actorId: string
): Promise<ProductRow> {
  const now = Date.now();
  const built = await buildCreateProductStmts(db, input, actorId, input.branchId, now);
  // Direct intake has no purchase/manufacturing posting behind it, so without
  // this row the metal sits in held stock with no ledger inflow and
  // gold_stock_consistency fails by exactly its weight. Type OPENING is
  // deliberately excluded from the day-scoped PURCHASE cross-foot (that query
  // matches invoice documents only). No journal is posted here: money never
  // moved. A full financial opening-balance flow is a separate, larger piece
  // of work — see the system audit.
  const purity = await db
    .prepare("SELECT permille FROM purities WHERE id = ?")
    .bind(input.purityId)
    .first<{ permille: number }>();
  if (!purity) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
  const goldStmts = await postGoldStmts(
    db,
    [
      {
        branchId: input.branchId,
        source: "opening",
        destination: `branch:${input.branchId}`,
        type: "OPENING",
        weightMg: built.netMg,
        permille: purity.permille,
        refEntity: "product_intake",
        refId: built.id,
        productId: built.id,
        notes: `Direct intake ${built.barcode}`,
      },
    ],
    { actorId, auditAction: "product.intake.gold", auditEntity: "product", auditEntityId: built.id, branchId: input.branchId }
  );
  await db.batch([...built.stmts, ...goldStmts]);
  const created = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(built.id).first<RawRow>();
  if (!created) throw new Error("Product insert failed");
  return parseRow(created);
}

export async function editProduct(
  db: D1Database,
  id: string,
  patch: EditProductInput,
  actorId: string
): Promise<ProductRow> {
  const prev = await db
    .prepare("SELECT id, status, branch_id, selling_price_cents FROM products WHERE id = ?")
    .bind(id)
    .first<{ id: string; status: string; branch_id: string; selling_price_cents: number | null }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (prev.status === "VOID")
    throw Object.assign(new Error("Void products cannot be edited"), { code: "CONFLICT" });
  // Price overrides go through the unified engine. A first-time price (none
  // set) always counts as an override (metric 100); otherwise the metric is
  // the absolute change pct rounded to 2dp so terms bind exactly on retry.
  if (patch.sellingPriceLkr !== undefined) {
    const nextCents = lkrToCents(patch.sellingPriceLkr);
    const metric =
      prev.selling_price_cents === null || prev.selling_price_cents <= 0
        ? 100
        : Math.round((Math.abs(nextCents - prev.selling_price_cents) / prev.selling_price_cents) * 100 * 100) / 100;
    if (patch.approvalId) {
      await consumeApproval(
        db,
        { action: "PRICE_OVERRIDE", id: patch.approvalId, entity: "product", entityId: id, metric },
        actorId
      );
    } else if (metric > 0) {
      const req = await requestApproval(
        db,
        {
          action: "PRICE_OVERRIDE",
          entity: "product",
          entityId: id,
          oldValue: { sellingPriceCents: prev.selling_price_cents },
          newValue: { sellingPriceCents: nextCents },
          metric,
          reason: `price ${prev.selling_price_cents ?? "unset"} → ${nextCents}c`,
          branchId: prev.branch_id,
        },
        actorId
      );
      if (req.status === "PENDING") pendingApproval(req, "PRICE_OVERRIDE");
    }
  }
  if (patch.subcategoryId) await checkRef(db, "subcategories", patch.subcategoryId, "Subcategory");
  if (patch.designId) await checkRef(db, "designs", patch.designId, "Design");
  if (patch.productTypeId) await checkRef(db, "product_types", patch.productTypeId, "Product type");
  if (patch.metalTypeId) await checkRef(db, "metal_types", patch.metalTypeId, "Metal type");
  if (patch.stoneTypeId) await checkRef(db, "stone_types", patch.stoneTypeId, "Stone type");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.subcategoryId !== undefined) {
    sets.push("subcategory_id = ?");
    vals.push(patch.subcategoryId);
  }
  if (patch.designId !== undefined) {
    sets.push("design_id = ?");
    vals.push(patch.designId);
  }
  if (patch.productTypeId !== undefined) {
    sets.push("product_type_id = ?");
    vals.push(patch.productTypeId);
  }
  if (patch.metalTypeId !== undefined) {
    sets.push("metal_type_id = ?");
    vals.push(patch.metalTypeId);
  }
  if (patch.stoneTypeId !== undefined) {
    sets.push("stone_type_id = ?");
    vals.push(patch.stoneTypeId);
  }
  if (patch.makingLkr !== undefined) {
    sets.push("making_cents = ?");
    vals.push(lkrToCents(patch.makingLkr));
  }
  if (patch.wastageG !== undefined) {
    sets.push("wastage_mg = ?");
    vals.push(gToMg(patch.wastageG));
  }
  if (patch.costLkr !== undefined) {
    sets.push("cost_cents = ?");
    vals.push(lkrToCents(patch.costLkr));
  }
  if (patch.sellingPriceLkr !== undefined) {
    sets.push("selling_price_cents = ?");
    vals.push(lkrToCents(patch.sellingPriceLkr));
  }
  if (patch.location !== undefined) {
    sets.push("location = ?");
    vals.push(patch.location);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(patch.notes);
  }
  if (sets.length > 0) {
    await db.batch([
      db.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
      buildAuditStmt(db, {
        userId: actorId,
        action: "product.edit",
        entity: "product",
        entityId: id,
        next: patch,
        branchId: prev.branch_id,
      }),
    ]);
  }
  const updated = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<RawRow>();
  if (!updated) throw new Error("Product update failed");
  return parseRow(updated);
}

export type ProductListOpts = PageOpts & {
  status?: string;
  categoryId?: string;
  purityId?: string;
  branchId?: string;
  minG?: number;
  maxG?: number;
  minPriceLkr?: number;
  maxPriceLkr?: number;
};

export async function listProducts(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: ProductListOpts
): Promise<{ rows: ProductRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)"];
  const vals: unknown[] = [like, like, like];
  if (opts.status) {
    conds.push("p.status = ?");
    vals.push(opts.status);
  }
  if (opts.categoryId) {
    conds.push("p.category_id = ?");
    vals.push(opts.categoryId);
  }
  if (opts.purityId) {
    conds.push("p.purity_id = ?");
    vals.push(opts.purityId);
  }
  if (opts.branchId) {
    conds.push("p.branch_id = ?");
    vals.push(opts.branchId);
  } else if (!canManageAll) {
    conds.push("p.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)");
    vals.push(userId);
  }
  if (opts.minG !== undefined) {
    conds.push("p.net_mg >= ?");
    vals.push(gToMg(opts.minG));
  }
  if (opts.maxG !== undefined) {
    conds.push("p.net_mg <= ?");
    vals.push(gToMg(opts.maxG));
  }
  if (opts.minPriceLkr !== undefined) {
    conds.push("p.selling_price_cents >= ?");
    vals.push(lkrToCents(opts.minPriceLkr));
  }
  if (opts.maxPriceLkr !== undefined) {
    conds.push("p.selling_price_cents <= ?");
    vals.push(lkrToCents(opts.maxPriceLkr));
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM products p ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`${WITH_NAMES} ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...vals, opts.limit, offset)
    .all<RawRow>();
  return { rows: (results ?? []).map(parseRow), total: count?.total ?? 0 };
}

async function withPrice(db: D1Database, row: RawRow | null): Promise<ProductDetail> {
  if (!row) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  const product = parseRow(row);
  const { livePrice, noRate } = await priceFor(db, product.purity_id, product.net_mg, product.making_cents);
  return { product, livePrice, noRate };
}

export async function getProduct(db: D1Database, id: string): Promise<ProductDetail> {
  return withPrice(db, await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<RawRow>());
}

export async function findByBarcode(db: D1Database, code: string): Promise<ProductDetail> {
  return withPrice(
    db,
    await db
      .prepare(`${WITH_NAMES} WHERE UPPER(p.barcode) = UPPER(?)`)
      .bind(code.trim())
      .first<RawRow>()
  );
}

export async function buildVoidProductStmts(
  db: D1Database,
  id: string,
  actorId: string,
  reason: string,
  now: number
): Promise<{ stmts: D1PreparedStatement[]; branchId: string; netMg: number }> {
  const prev = await db
    .prepare("SELECT id, status, branch_id, net_mg FROM products WHERE id = ?")
    .bind(id)
    .first<{ id: string; status: string; branch_id: string; net_mg: number }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (prev.status === "VOID")
    throw Object.assign(new Error("Product already void"), { code: "CONFLICT" });
  const stmts = [
    db.prepare("UPDATE products SET status = 'VOID' WHERE id = ?").bind(id),
    db
      .prepare(
        "INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'VOID', ?, 'VOID', ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        id,
        prev.status,
        prev.branch_id,
        prev.branch_id,
        prev.net_mg,
        reason,
        now,
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "product.void",
      entity: "product",
      entityId: id,
      prev: { status: prev.status },
      next: { status: "VOID" },
      reason,
      branchId: prev.branch_id,
    }),
  ];
  return { stmts, branchId: prev.branch_id, netMg: prev.net_mg };
}

export async function voidProduct(
  db: D1Database,
  id: string,
  actorId: string,
  reason: string
): Promise<void> {
  const built = await buildVoidProductStmts(db, id, actorId, reason, Date.now());
  await db.batch(built.stmts);
}
