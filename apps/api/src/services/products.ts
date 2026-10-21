import {
  fineGoldMg,
  gToMg,
  lkrToCents,
  extractScanCode,
  normalizeCode,
  priceCents,
  type BulkCreateProductsInput,
  type CreateProductInput,
  type EditProductInput,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRatesCents } from "./rates";
import { consumeApproval, pendingApproval, requestApproval } from "./approvals";
import { postGoldStmts } from "./gold";
import { buildOpeningStockStmts, carriedOpeningValue, isDirectIntake } from "./openingstock";
import { assertCountLock } from "./counts";

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
  reserved_customer_id: string | null;
  reserved_customer_name: string | null;
  reserved_note: string | null;
  reserved_until: number | null;
  reserved_at: number | null;
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
  "SELECT p.id, p.barcode, p.sku, p.category_id, c.name AS category_name, p.subcategory_id, p.design_id, p.product_type_id, p.metal_type_id, m.name AS metal_name, p.stone_type_id, p.purity_id, pu.karat, pu.permille, p.name, p.gross_mg, p.stone_mg, p.net_mg, p.fine_gold_mg, p.making_cents, p.wastage_mg, p.cost_cents, p.selling_price_cents, p.location, p.notes, p.image_keys, p.status, p.branch_id, p.reserved_customer_id, rc.name AS reserved_customer_name, p.reserved_note, p.reserved_until, p.reserved_at, p.created_at FROM products p JOIN categories c ON c.id = p.category_id JOIN metal_types m ON m.id = p.metal_type_id JOIN purities pu ON pu.id = p.purity_id LEFT JOIN customers rc ON rc.id = p.reserved_customer_id";

function parseRow(r: RawRow): ProductRow {
  return { ...r, image_keys: JSON.parse(r.image_keys) as string[] };
}

/** What a product points at — everything but its weights and money. */
type ProductRefs = Pick<
  CreateProductInput,
  "categoryId" | "subcategoryId" | "subcategoryName" | "designId" | "productTypeId" | "metalTypeId" | "stoneTypeId" | "purityId"
>;

const BARCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(prefix: "SKU-"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = prefix;
  for (const b of bytes) s += BARCODE_ALPHABET[b % BARCODE_ALPHABET.length];
  return s;
}

/** Four-digit numbers per letter pair: 0001 to 9999, then the next pair. */
const NUMBERS_PER_SERIES = 9999;

/**
 * A barcode is the category's code, a dash, two letters, a dash, then a
 * four-digit number: BBR-AA-0001 … BBR-AA-9999, then BBR-AB-0001, and on through
 * the alphabet (AA, AB, …, AZ, BA, …). `no` is the category's running count of
 * pieces, starting at 1. The code is capitals, letters and digits, with dashes
 * between the parts, so it scans like a typed one.
 */
export function categoryBarcode(code: string, no: number): string {
  const prefix = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const series = Math.floor((no - 1) / NUMBERS_PER_SERIES);
  if (series >= 26 * 26)
    throw Object.assign(new Error("This category has used all its barcodes"), { code: "CONFLICT" });
  const letters = String.fromCharCode(65 + Math.floor(series / 26), 65 + (series % 26));
  const number = ((no - 1) % NUMBERS_PER_SERIES) + 1;
  return `${prefix}-${letters}-${String(number).padStart(4, "0")}`;
}

/** The counter that numbers a category's pieces, one per category. */
const barcodeCounter = (categoryId: string) => `BARCODE:${categoryId}`;

async function categoryCode(db: D1Database, categoryId: string): Promise<string> {
  const row = await db.prepare("SELECT code FROM categories WHERE id = ?").bind(categoryId).first<{ code: string }>();
  if (!row) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  if (!row.code.replace(/[^A-Za-z0-9]/g, ""))
    throw Object.assign(new Error("This category has no code to make barcodes from"), { code: "VALIDATION" });
  return row.code;
}

/**
 * The barcode the category's next piece will get, without taking it. Shown on
 * the product form before the piece is saved.
 */
export async function nextCategoryBarcode(db: D1Database, categoryId: string): Promise<string> {
  const code = await categoryCode(db, categoryId);
  const row = await db
    .prepare("SELECT next FROM counters WHERE name = ?")
    .bind(barcodeCounter(categoryId))
    .first<{ next: number }>();
  return categoryBarcode(code, row?.next ?? 1);
}

/**
 * `n` barcodes for a category, each one taken from its counter. A number that
 * already belongs to a product is skipped, so a counter that has fallen behind
 * never produces a duplicate.
 */
async function categoryBarcodes(db: D1Database, categoryId: string, n: number): Promise<string[]> {
  const code = await categoryCode(db, categoryId);
  const name = barcodeCounter(categoryId);
  await db.prepare("INSERT INTO counters (name, next) VALUES (?, 1) ON CONFLICT(name) DO NOTHING").bind(name).run();
  const out: string[] = [];
  for (let tries = 0; out.length < n; tries++) {
    if (tries > n * 50 + 200) throw Object.assign(new Error("Could not allocate barcodes"), { code: "INTERNAL" });
    const row = await db
      .prepare("UPDATE counters SET next = next + 1 WHERE name = ? RETURNING next - 1 AS allocated")
      .bind(name)
      .first<{ allocated: number }>();
    if (!row) throw Object.assign(new Error(`Counter ${name} missing`), { code: "INTERNAL" });
    const barcode = categoryBarcode(code, row.allocated);
    const taken = await db.prepare("SELECT 1 AS x FROM products WHERE barcode = ?").bind(barcode).first();
    if (!taken) out.push(barcode);
  }
  return out;
}

/** Barcode and SKU lookups per query, kept well inside the bind-parameter cap. */
const CODE_CHECK_CHUNK = 40;

/**
 * `n` fresh barcode/SKU pairs for pieces of one category: the barcodes come in
 * order from the category's counter, the SKUs are random, and none of them is
 * already on file (the unique indexes remain the backstop).
 */
async function uniqueCodeBatch(db: D1Database, categoryId: string, n: number): Promise<{ barcode: string; sku: string }[]> {
  const barcodes = await categoryBarcodes(db, categoryId, n);
  const out: { barcode: string; sku: string }[] = [];
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 5 && out.length < n; attempt++) {
    const cand: string[] = [];
    while (cand.length < n - out.length) {
      const sku = randomCode("SKU-");
      if (seen.has(sku)) continue;
      seen.add(sku);
      cand.push(sku);
    }
    const taken = new Set<string>();
    for (let i = 0; i < cand.length; i += CODE_CHECK_CHUNK) {
      const chunk = cand.slice(i, i + CODE_CHECK_CHUNK);
      const marks = chunk.map(() => "?").join(", ");
      const { results } = await db
        .prepare(`SELECT sku FROM products WHERE sku IN (${marks})`)
        .bind(...chunk)
        .all<{ sku: string }>();
      for (const r of results ?? []) taken.add(r.sku);
    }
    for (const sku of cand) if (!taken.has(sku)) out.push({ barcode: barcodes[out.length]!, sku });
  }
  if (out.length < n) throw Object.assign(new Error("Could not generate unique code"), { code: "INTERNAL" });
  return out;
}

async function uniqueCodes(db: D1Database, categoryId: string): Promise<{ barcode: string; sku: string }> {
  return (await uniqueCodeBatch(db, categoryId, 1))[0]!;
}

async function categoryName(db: D1Database, id: string): Promise<string> {
  const row = await db.prepare("SELECT name FROM categories WHERE id = ?").bind(id).first<{ name: string }>();
  return row?.name ?? "Item";
}

/**
 * A typed subcategory is matched (case-insensitively, within the category) to
 * an existing one, or created in the same batch as the product.
 */
async function resolveSubcategory(
  db: D1Database,
  input: ProductRefs,
  actorId: string,
  now: number
): Promise<{ id: string | undefined; name: string | undefined; stmts: D1PreparedStatement[] }> {
  if (input.subcategoryId || !input.subcategoryName) return { id: input.subcategoryId, name: undefined, stmts: [] };
  const typed = input.subcategoryName;
  const found = await db
    .prepare("SELECT id, name FROM subcategories WHERE category_id = ? AND lower(name) = lower(?) AND is_active = 1")
    .bind(input.categoryId, typed)
    .first<{ id: string; name: string }>();
  if (found) return { id: found.id, name: found.name, stmts: [] };
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = "SC-" + randomCode("SKU-").slice(4);
    if (!(await db.prepare("SELECT 1 AS x FROM subcategories WHERE code = ?").bind(c).first())) {
      code = c;
      break;
    }
  }
  if (!code) throw Object.assign(new Error("Could not generate subcategory code"), { code: "INTERNAL" });
  const id = crypto.randomUUID();
  return {
    id,
    name: typed,
    stmts: [
      db
        .prepare("INSERT INTO subcategories (id, category_id, name, code, is_active, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)")
        .bind(id, input.categoryId, typed, code, now, actorId),
      buildAuditStmt(db, {
        userId: actorId,
        action: "subcategory.create",
        entity: "subcategory",
        entityId: id,
        next: { categoryId: input.categoryId, name: typed, code },
      }),
    ],
  };
}

/**
 * Every reference a new product names, validated in a single round trip.
 * Returns the purity's permille (needed for the fine weight).
 */
async function validateRefs(db: D1Database, input: ProductRefs, branchId: string): Promise<number> {
  const checks: { sql: string; id: string; label: string }[] = [];
  const active = (table: string, id: string, label: string) =>
    checks.push({ sql: `(SELECT 1 FROM ${table} WHERE id = ? AND is_active = 1)`, id, label });
  active("categories", input.categoryId, "Category");
  if (input.subcategoryId) active("subcategories", input.subcategoryId, "Subcategory");
  if (input.designId) active("designs", input.designId, "Design");
  if (input.productTypeId) active("product_types", input.productTypeId, "Product type");
  active("metal_types", input.metalTypeId, "Metal type");
  if (input.stoneTypeId) active("stone_types", input.stoneTypeId, "Stone type");
  active("purities", input.purityId, "Purity");
  checks.push({ sql: "(SELECT 1 FROM branches WHERE id = ? AND is_active = 1)", id: branchId, label: "Branch" });
  const cols = checks.map((c, i) => `${c.sql} AS c${i}`).join(", ");
  const row = await db
    .prepare(`SELECT ${cols}, (SELECT permille FROM purities WHERE id = ?) AS permille`)
    .bind(...checks.map((c) => c.id), input.purityId)
    .first<Record<string, number | null>>();
  const missing = checks.findIndex((_, i) => !row?.[`c${i}`]);
  if (missing >= 0) {
    const label = checks[missing]!.label;
    throw Object.assign(new Error(label === "Branch" ? "Branch not found" : `${label} not found or inactive`), { code: "NOT_FOUND" });
  }
  if (!row?.permille) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
  return row.permille;
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
  permille: number;
};

/** Gross, stone and net in mg; a stone as heavy as the piece is refused. */
function pieceWeights(grossG: number, stoneG: number, label = ""): { grossMg: number; stoneMg: number; netMg: number } {
  const grossMg = gToMg(grossG);
  const stoneMg = gToMg(stoneG);
  const netMg = grossMg - stoneMg;
  if (netMg <= 0)
    throw Object.assign(new Error(`${label}Stone weight must be less than gross weight`), {
      code: "VALIDATION",
    });
  return { grossMg, stoneMg, netMg };
}

/**
 * The rows one new piece writes: the product itself (IN_STOCK), its INTAKE
 * movement and its create audit. References are already validated and the
 * codes already minted by the caller.
 */
function pieceStmts(
  db: D1Database,
  p: {
    id: string;
    barcode: string;
    sku: string;
    input: CreateProductInput;
    subcategoryId: string | undefined;
    name: string;
    weights: { grossMg: number; stoneMg: number; netMg: number };
    permille: number;
    branchId: string;
    now: number;
    actorId: string;
    batchId?: string;
  }
): D1PreparedStatement[] {
  const { input, weights } = p;
  return [
    db
      .prepare(
        "INSERT INTO products (id, barcode, sku, category_id, subcategory_id, design_id, product_type_id, metal_type_id, stone_type_id, purity_id, name, gross_mg, stone_mg, net_mg, fine_gold_mg, making_cents, wastage_mg, cost_cents, selling_price_cents, location, notes, image_keys, status, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?, ?, ?)"
      )
      .bind(
        p.id,
        p.barcode,
        p.sku,
        input.categoryId,
        p.subcategoryId ?? null,
        input.designId ?? null,
        input.productTypeId ?? null,
        input.metalTypeId,
        input.stoneTypeId ?? null,
        input.purityId,
        p.name,
        weights.grossMg,
        weights.stoneMg,
        weights.netMg,
        fineGoldMg(weights.netMg, p.permille),
        lkrToCents(input.makingLkr),
        gToMg(input.wastageG),
        input.costLkr !== undefined ? lkrToCents(input.costLkr) : null,
        input.sellingPriceLkr !== undefined && input.sellingPriceLkr > 0 ? lkrToCents(input.sellingPriceLkr) : null,
        input.location ?? null,
        input.notes ?? null,
        "[]",
        p.branchId,
        p.now,
        p.actorId
      ),
    db
      .prepare(
        "INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'INTAKE', NULL, 'IN_STOCK', NULL, ?, ?, 'intake', ?, ?)"
      )
      .bind(crypto.randomUUID(), p.id, p.branchId, weights.netMg, p.now, p.actorId),
    buildAuditStmt(db, {
      userId: p.actorId,
      action: "product.create",
      entity: "product",
      entityId: p.id,
      next: { ...input, barcode: p.barcode, sku: p.sku, ...(p.batchId ? { batchId: p.batchId } : {}) },
      branchId: p.branchId,
    }),
  ];
}

export async function buildCreateProductStmts(
  db: D1Database,
  input: CreateProductInput,
  actorId: string,
  branchId: string,
  now: number
): Promise<BuiltProduct> {
  const weights = pieceWeights(input.grossG, input.stoneG);
  // Independent reads, run together instead of one after another.
  const [permille, codes] = await Promise.all([validateRefs(db, input, branchId), uniqueCodes(db, input.categoryId)]);
  const { barcode, sku } = codes;
  const sub = await resolveSubcategory(db, input, actorId, now);
  const name = input.name ?? sub.name ?? (await categoryName(db, input.categoryId));
  const id = crypto.randomUUID();
  const stmts = [
    ...sub.stmts,
    ...pieceStmts(db, { id, barcode, sku, input, subcategoryId: sub.id, name, weights, permille, branchId, now, actorId }),
  ];
  return { stmts, id, barcode, sku, netMg: weights.netMg, permille };
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
  // matches invoice documents only). The book cost, when known, enters 1100
  // against 3100 Opening Balances in the same batch (see openingstock.ts).
  const [goldStmts, opening] = await Promise.all([
    postGoldStmts(
      db,
      [
        {
          branchId: input.branchId,
          source: "opening",
          destination: `branch:${input.branchId}`,
          type: "OPENING",
          weightMg: built.netMg,
          permille: built.permille,
          refEntity: "product_intake",
          refId: built.id,
          productId: built.id,
          notes: `Direct intake ${built.barcode}`,
        },
      ],
      { actorId, auditAction: "product.intake.gold", auditEntity: "product", auditEntityId: built.id, branchId: input.branchId }
    ),
    buildOpeningStockStmts(db, {
      productId: built.id,
      barcode: built.barcode,
      branchId: input.branchId,
      deltaCents: input.costLkr !== undefined ? lkrToCents(input.costLkr) : 0,
      actorId,
      reason: "direct intake",
    }),
  ]);
  await db.batch([...built.stmts, ...goldStmts, ...(opening?.stmts ?? [])]);
  const created = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(built.id).first<RawRow>();
  if (!created) throw new Error("Product insert failed");
  return parseRow(created);
}

export type BulkCreatedProduct = {
  id: string;
  barcode: string;
  sku: string;
  name: string;
  gross_mg: number;
  stone_mg: number;
  net_mg: number;
  fine_gold_mg: number;
};

export type BulkCreateResult = {
  batchId: string;
  products: BulkCreatedProduct[];
  totals: { count: number; gross_mg: number; net_mg: number; fine_gold_mg: number; cost_cents: number };
};

/**
 * A tray of like pieces taken in at once — 25 rings that share everything but
 * their weight (and perhaps a name, stone, price or tray). Each piece is a
 * full product, exactly as createProduct would make it: its own barcode and
 * SKU, INTAKE movement, OPENING gold row and, when costed, opening-stock
 * entry. The shared references are validated once and a typed subcategory is
 * created once, not per piece.
 *
 * All or nothing: every piece lands in one batch, so a bad row, a closed day
 * or a lost connection never leaves half a tray on the shelf. A bad row is
 * reported by its 1-based number so the counter can find it on screen.
 */
export async function createProductsBulk(
  db: D1Database,
  input: BulkCreateProductsInput,
  actorId: string
): Promise<BulkCreateResult> {
  const { common, items } = input;
  const branchId = common.branchId;
  const pieces = items.map((it, i) => {
    const merged: CreateProductInput = {
      ...common,
      name: it.name ?? common.name,
      grossG: it.grossG,
      stoneG: it.stoneG ?? common.stoneG,
      makingLkr: it.makingLkr ?? common.makingLkr,
      wastageG: it.wastageG ?? common.wastageG,
      costLkr: it.costLkr ?? common.costLkr,
      sellingPriceLkr: it.sellingPriceLkr ?? common.sellingPriceLkr,
      location: it.location ?? common.location,
      notes: it.notes ?? common.notes,
    };
    return { input: merged, weights: pieceWeights(merged.grossG, merged.stoneG, `Row ${i + 1}: `) };
  });

  const now = Date.now();
  const [permille, codes] = await Promise.all([validateRefs(db, common, branchId), uniqueCodeBatch(db, common.categoryId, pieces.length)]);
  const sub = await resolveSubcategory(db, common, actorId, now);
  const fallbackName = common.name ?? sub.name ?? (await categoryName(db, common.categoryId));
  const batchId = crypto.randomUUID();

  const built = pieces.map((p, i) => ({
    ...p,
    id: crypto.randomUUID(),
    barcode: codes[i]!.barcode,
    sku: codes[i]!.sku,
    name: p.input.name ?? fallbackName,
  }));

  const stmts: D1PreparedStatement[] = [...sub.stmts];
  for (const b of built)
    stmts.push(
      ...pieceStmts(db, {
        id: b.id,
        barcode: b.barcode,
        sku: b.sku,
        input: b.input,
        subcategoryId: sub.id,
        name: b.name,
        weights: b.weights,
        permille,
        branchId,
        now,
        actorId,
        batchId,
      })
    );

  // One OPENING gold row per piece (the day lock is checked once for all of
  // them), so each piece's metal is traceable and a later void reverses
  // exactly its own row — see createProduct for why direct intake needs it.
  stmts.push(
    ...(await postGoldStmts(
      db,
      built.map((b) => ({
        branchId,
        source: "opening",
        destination: `branch:${branchId}`,
        type: "OPENING",
        weightMg: b.weights.netMg,
        permille,
        refEntity: "product_intake",
        refId: b.id,
        productId: b.id,
        notes: `Direct intake ${b.barcode}`,
      })),
      { actorId, auditAction: "product.intake.gold", auditEntity: "product_batch", auditEntityId: batchId, branchId }
    ))
  );

  // Opening-stock value is carried per product (cost corrections and voids
  // net against the product's own entries), so each costed piece gets its
  // own entry. Sequential, so entry numbers follow the tray's order.
  for (const b of built) {
    if (b.input.costLkr === undefined) continue;
    const opening = await buildOpeningStockStmts(db, {
      productId: b.id,
      barcode: b.barcode,
      branchId,
      deltaCents: lkrToCents(b.input.costLkr),
      actorId,
      reason: "direct intake",
    });
    if (opening) stmts.push(...opening.stmts);
  }

  const products: BulkCreatedProduct[] = built.map((b) => ({
    id: b.id,
    barcode: b.barcode,
    sku: b.sku,
    name: b.name,
    gross_mg: b.weights.grossMg,
    stone_mg: b.weights.stoneMg,
    net_mg: b.weights.netMg,
    fine_gold_mg: fineGoldMg(b.weights.netMg, permille),
  }));
  const totals = {
    count: products.length,
    gross_mg: products.reduce((n, p) => n + p.gross_mg, 0),
    net_mg: products.reduce((n, p) => n + p.net_mg, 0),
    fine_gold_mg: products.reduce((n, p) => n + p.fine_gold_mg, 0),
    cost_cents: built.reduce((n, b) => n + (b.input.costLkr !== undefined ? lkrToCents(b.input.costLkr) : 0), 0),
  };
  stmts.push(
    buildAuditStmt(db, {
      userId: actorId,
      action: "product.bulk_create",
      entity: "product_batch",
      entityId: batchId,
      next: { common, ...totals, barcodes: products.map((p) => p.barcode) },
      branchId,
    })
  );

  await db.batch(stmts);
  return { batchId, products, totals };
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
  // A cost correction on a direct-intake piece still on the shelf moves its
  // carried value on 1100 by the difference. A sold piece's COGS is already
  // booked at the old cost, so its cost is history and is not re-posted.
  let costStmts: D1PreparedStatement[] = [];
  if (patch.costLkr !== undefined && !["SOLD", "VOID"].includes(prev.status) && (await isDirectIntake(db, id))) {
    const barcodeRow = await db.prepare("SELECT barcode FROM products WHERE id = ?").bind(id).first<{ barcode: string }>();
    const opening = await buildOpeningStockStmts(db, {
      productId: id,
      barcode: barcodeRow?.barcode ?? id,
      branchId: prev.branch_id,
      deltaCents: lkrToCents(patch.costLkr) - (await carriedOpeningValue(db, id)),
      actorId,
      reason: "cost correction",
    });
    costStmts = opening?.stmts ?? [];
  }
  if (sets.length > 0) {
    await db.batch([
      ...costStmts,
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
  // A QR tag may carry a link or JSON around the code.
  const norm = extractScanCode(code);
  if (!norm) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  // Barcode (JW-/PRD-) and SKU (SKU-) prefixes are disjoint, so at most one
  // row matches; SKU scans come from stock sheets and older tags.
  return withPrice(
    db,
    await db
      .prepare(`${WITH_NAMES} WHERE p.barcode = ? OR p.sku = ?`)
      .bind(norm, norm)
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
  // A customer is waiting on a held piece; the hold is ended on purpose first.
  if (prev.status === "RESERVED")
    throw Object.assign(new Error("Release the reservation before voiding"), { code: "CONFLICT" });
  // A piece frozen in an open count cannot leave stock under the counter's
  // feet — the same lock sales, transfers and movements honour.
  await assertCountLock(db, id);
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
  const before = await db
    .prepare("SELECT p.status, p.barcode, p.net_mg, pu.permille FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id = ?")
    .bind(id)
    .first<{ status: string; barcode: string; net_mg: number; permille: number }>();
  const built = await buildVoidProductStmts(db, id, actorId, reason, Date.now());
  // A voided direct-intake piece still on the shelf un-does its intake: the
  // metal leaves the gold ledger the way it came in (an OPENING row, branch →
  // opening), and its opening value comes back off 1100. Without the gold row
  // the piece left stock on hand while its OPENING inflow stayed, and
  // gold_stock_consistency — a close gate — failed by its weight for good.
  // A piece that already left (sold, lost, melted) left through that flow's
  // own postings, so nothing is reversed twice. Purchased pieces are voided
  // through their invoice, which reverses the receive.
  const stmts: D1PreparedStatement[] = [...built.stmts];
  if (before && !["SOLD", "LOST", "MELTED"].includes(before.status) && (await isDirectIntake(db, id))) {
    if (before.net_mg > 0)
      stmts.push(
        ...(await postGoldStmts(
          db,
          [
            {
              branchId: built.branchId,
              source: `branch:${built.branchId}`,
              destination: "opening",
              type: "OPENING",
              weightMg: before.net_mg,
              permille: before.permille,
              refEntity: "product_intake",
              refId: id,
              productId: id,
              notes: `Void of direct intake ${before.barcode}: ${reason}`,
            },
          ],
          { actorId, auditAction: "product.void.gold", auditEntity: "product", auditEntityId: id, branchId: built.branchId }
        ))
      );
    const opening = await buildOpeningStockStmts(db, {
      productId: id,
      barcode: before.barcode,
      branchId: built.branchId,
      deltaCents: -(await carriedOpeningValue(db, id)),
      actorId,
      reason: `void: ${reason}`,
    });
    stmts.push(...(opening?.stmts ?? []));
  }
  await db.batch(stmts);
}
