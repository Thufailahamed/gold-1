import { BARCODE_RE, type CreateProductInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRates } from "./rates";

export type ProductRow = {
  id: string;
  barcode: string;
  category_id: string;
  category_name: string;
  purity_id: string;
  karat: string;
  name: string;
  gross_weight: number;
  stone_weight: number;
  net_weight: number;
  making_charge: number;
  status: string;
  branch_id: string;
  created_at: number;
};

export type LivePrice = {
  amount: number;
  ratePerGram: number;
  rateEffectiveFrom: number;
} | null;

export type ProductDetail = { product: ProductRow; livePrice: LivePrice; noRate: boolean };

const WITH_NAMES =
  "SELECT p.id, p.barcode, p.category_id, c.name AS category_name, p.purity_id, pu.karat, p.name, p.gross_weight, p.stone_weight, p.net_weight, p.making_charge, p.status, p.branch_id, p.created_at FROM products p JOIN categories c ON c.id = p.category_id JOIN purities pu ON pu.id = p.purity_id";

const BARCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomBarcode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "PRD-";
  for (const b of bytes) s += BARCODE_ALPHABET[b % BARCODE_ALPHABET.length];
  return s;
}

export async function priceFor(
  db: D1Database,
  purityId: string,
  netWeight: number,
  makingCharge: number
): Promise<{ livePrice: LivePrice; noRate: boolean }> {
  const rates = await currentGoldRates(db);
  const rate = rates.find((r) => r.purity_id === purityId);
  if (!rate) return { livePrice: null, noRate: true };
  return {
    livePrice: {
      amount: Math.round((netWeight * rate.rate_per_gram + makingCharge) * 100) / 100,
      ratePerGram: rate.rate_per_gram,
      rateEffectiveFrom: rate.effective_from,
    },
    noRate: false,
  };
}

export async function createProduct(
  db: D1Database,
  input: CreateProductInput,
  actorId: string
): Promise<ProductRow> {
  const category = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1")
    .bind(input.categoryId)
    .first<{ id: string }>();
  if (!category)
    throw Object.assign(new Error("Category not found or inactive"), { code: "NOT_FOUND" });
  const purity = await db
    .prepare("SELECT id FROM purities WHERE id = ? AND is_active = 1")
    .bind(input.purityId)
    .first<{ id: string }>();
  if (!purity) throw Object.assign(new Error("Purity not found or inactive"), { code: "NOT_FOUND" });
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first<{ id: string }>();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const net = input.grossWeight - input.stoneWeight;
  if (net <= 0)
    throw Object.assign(new Error("Stone weight must be less than gross weight"), {
      code: "VALIDATION",
    });

  let barcode = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomBarcode();
    if (! BARCODE_RE.test(candidate)) continue;
    const dup = await db
      .prepare("SELECT id FROM products WHERE barcode = ?")
      .bind(candidate)
      .first();
    if (!dup) {
      barcode = candidate;
      break;
    }
  }
  if (!barcode)
    throw Object.assign(new Error("Could not generate unique barcode"), { code: "INTERNAL" });

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO products (id, barcode, category_id, purity_id, name, gross_weight, stone_weight, net_weight, making_charge, status, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_stock', ?, ?, ?)"
      )
      .bind(
        id,
        barcode,
        input.categoryId,
        input.purityId,
        input.name,
        input.grossWeight,
        input.stoneWeight,
        net,
        input.makingCharge,
        input.branchId,
        now,
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "product.create",
      entity: "product",
      entityId: id,
      next: { ...input, barcode, net_weight: net },
      branchId: input.branchId,
    }),
  ]);
  const created = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<ProductRow>();
  if (!created) throw new Error("Product insert failed");
  return created;
}

export type ProductListOpts = PageOpts & { status?: string; categoryId?: string; branchId?: string };

export async function listProducts(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: ProductListOpts
): Promise<{ rows: ProductRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(p.name LIKE ? OR p.barcode LIKE ?)"];
  const vals: unknown[] = [like, like];
  if (opts.status) {
    conds.push("p.status = ?");
    vals.push(opts.status);
  }
  if (opts.categoryId) {
    conds.push("p.category_id = ?");
    vals.push(opts.categoryId);
  }
  if (opts.branchId) {
    conds.push("p.branch_id = ?");
    vals.push(opts.branchId);
  } else if (!canManageAll) {
    conds.push("p.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)");
    vals.push(userId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM products p ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`${WITH_NAMES} ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...vals, opts.limit, offset)
    .all<ProductRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

async function withPrice(db: D1Database, row: ProductRow | null): Promise<ProductDetail> {
  if (!row) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  const { livePrice, noRate } = await priceFor(db, row.purity_id, row.net_weight, row.making_charge);
  return { product: row, livePrice, noRate };
}

export async function getProduct(db: D1Database, id: string): Promise<ProductDetail> {
  const row = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<ProductRow>();
  return withPrice(db, row);
}

export async function findByBarcode(db: D1Database, code: string): Promise<ProductDetail> {
  const row = await db
    .prepare(`${WITH_NAMES} WHERE UPPER(p.barcode) = UPPER(?)`)
    .bind(code.trim())
    .first<ProductRow>();
  return withPrice(db, row);
}

export async function voidProduct(
  db: D1Database,
  id: string,
  actorId: string,
  reason: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, status, branch_id FROM products WHERE id = ?")
    .bind(id)
    .first<{ id: string; status: string; branch_id: string }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (prev.status === "void")
    throw Object.assign(new Error("Product already void"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE products SET status = 'void' WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "product.void",
      entity: "product",
      entityId: id,
      prev: { status: prev.status },
      next: { status: "void" },
      reason,
      branchId: prev.branch_id,
    }),
  ]);
}
