import type { BillLine, SaleBillReading } from "../ai/salebill-scan";

/**
 * Matches a read sale bill to the shop's records: each line to the product
 * it names (by barcode), or, for a "New" line, to the old-gold pieces it could
 * have been taken from; the customer by phone. Only suggestions: the till
 * picks, and the sale posts through the normal checkout.
 */

/** A bill weight and the piece's weight may differ by a scale's rounding. */
const SAME_WEIGHT_MG = 10;
/** How far off a candidate may be and still be offered for a line with no barcode. */
const NEAR_WEIGHT_MG = 300;

export type BillProduct = { id: string; barcode: string; name: string; karat: string; netMg: number; grossMg: number; status: string; branchId: string; categoryName: string };
export type BillOldGold = { id: string; number: string; description: string; itemType: string; netMg: number; karat: string | null };

export type MatchedLine = BillLine & {
  /** How the line was matched: a barcode on the bill, a unique weight, or not at all. */
  match: "barcode" | "weight" | "none";
  product: BillProduct | null;
  /** Other pieces in stock near this weight, for the till to choose from. */
  candidates: BillProduct[];
  /** For a "New" line: available old gold near this weight, nearest first. */
  oldGold: BillOldGold[];
  /** For a "New" line: the category the converted product most likely belongs to. */
  categoryId: string | null;
  warnings: string[];
};

export type SaleBillMatch = Omit<SaleBillReading, "lines"> & {
  lines: MatchedLine[];
  customerMatch: { id: string; name: string; code: string; phone: string | null } | null;
  /** For converting "New" lines from old gold. */
  categories: { id: string; name: string }[];
  metalTypeId: string | null;
};

const PRODUCT_COLS =
  "p.id, p.barcode, p.name, pu.karat, p.net_mg AS netMg, p.gross_mg AS grossMg, p.status, p.branch_id AS branchId, COALESCE(c.name, '') AS categoryName";
const PRODUCT_FROM = "products p JOIN purities pu ON pu.id = p.purity_id LEFT JOIN categories c ON c.id = p.category_id";

const words = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);

/** Handwriting spells loosely ("Bracelats", "Necklas"): two words match on their first four letters. */
const stem = (w: string) => w.slice(0, 4);

/** How many words of the bill's description the name shares. */
function likeness(description: string | null, name: string): number {
  const want = new Set(words(description).map(stem));
  return words(name).filter((w) => want.has(stem(w))).length;
}

const weightGap = (p: { netMg: number; grossMg: number }, mg: number) => Math.min(Math.abs(p.netMg - mg), Math.abs(p.grossMg - mg));
const weightGapOld = (o: BillOldGold, mg: number | null) => (mg ? Math.abs(o.netMg - mg) : Infinity);

async function byBarcode(db: D1Database, code: string): Promise<BillProduct | null> {
  return db
    .prepare(`SELECT ${PRODUCT_COLS} FROM ${PRODUCT_FROM} WHERE UPPER(p.barcode) = UPPER(?) OR UPPER(p.sku) = UPPER(?) LIMIT 1`)
    .bind(code, code)
    .first<BillProduct>();
}

async function nearWeight(db: D1Database, branchId: string, mg: number): Promise<BillProduct[]> {
  const { results } = await db
    .prepare(
      `SELECT ${PRODUCT_COLS} FROM ${PRODUCT_FROM}
       WHERE p.branch_id = ? AND p.status IN ('IN_STOCK', 'RESERVED')
         AND (ABS(p.net_mg - ?) <= ? OR ABS(p.gross_mg - ?) <= ?)
       ORDER BY MIN(ABS(p.net_mg - ?), ABS(p.gross_mg - ?)) LIMIT 20`
    )
    .bind(branchId, mg, NEAR_WEIGHT_MG, mg, NEAR_WEIGHT_MG, mg, mg)
    .all<BillProduct>();
  return results ?? [];
}

async function oldGoldNear(db: D1Database, branchId: string, mg: number): Promise<BillOldGold[]> {
  // Only pieces that can be converted: available, with a purity and a cost.
  const { results } = await db
    .prepare(
      `SELECT id, number, description, item_type AS itemType, net_mg AS netMg, karat FROM old_gold_items
       WHERE branch_id = ? AND status = 'AVAILABLE' AND purity_id IS NOT NULL AND purchase_value_cents IS NOT NULL AND ABS(net_mg - ?) <= ?
       ORDER BY ABS(net_mg - ?) LIMIT 5`
    )
    .bind(branchId, mg, NEAR_WEIGHT_MG, mg)
    .all<BillOldGold>();
  return results ?? [];
}

/** Matched on the last nine digits, so 0776328343, +94 77 632 8343 and 776-328343 are one number. */
async function customerByPhone(db: D1Database, phone: string): Promise<SaleBillMatch["customerMatch"]> {
  const hit = await db
    .prepare(
      "SELECT id, name, code, phone FROM customers WHERE is_active = 1 AND SUBSTR(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), -9) = ? ORDER BY created_at LIMIT 1"
    )
    .bind(phone.replace(/\D/g, "").slice(-9))
    .first<{ id: string; name: string; code: string | null; phone: string | null }>();
  return hit ? { id: hit.id, name: hit.name, code: hit.code ?? "", phone: hit.phone } : null;
}

export async function matchSaleBill(db: D1Database, branchId: string, bill: SaleBillReading): Promise<SaleBillMatch> {
  const { results: cats } = await db.prepare("SELECT id, name FROM categories WHERE is_active = 1 ORDER BY name").all<{ id: string; name: string }>();
  const categories = cats ?? [];
  const metal = await db
    .prepare("SELECT id FROM metal_types WHERE is_active = 1 ORDER BY (LOWER(name) LIKE '%gold%') DESC, created_at LIMIT 1")
    .first<{ id: string }>();

  // A piece is sold once: a later line never takes a piece an earlier one matched.
  const used = new Set<string>();
  const lines: MatchedLine[] = [];
  for (const l of bill.lines) {
    const out: MatchedLine = { ...l, match: "none", product: null, candidates: [], oldGold: [], categoryId: null, warnings: [] };
    const mg = l.weightMg;

    if (l.fromOldGold) {
      if (mg) out.oldGold = await oldGoldNear(db, branchId, mg);
      const best = categories.map((c) => ({ c, n: likeness(l.description, c.name) })).sort((a, b) => b.n - a.n)[0];
      out.categoryId = best && best.n > 0 ? best.c.id : null;
      if (!out.oldGold.length) out.warnings.push("No available old gold near this weight. Pick the piece on the old gold desk, or scan a tagged product instead.");
      else if (weightGapOld(out.oldGold[0]!, mg) > SAME_WEIGHT_MG) out.warnings.push("No old gold piece has exactly this weight. Check the nearest one before using it.");
      lines.push(out);
      continue;
    }

    if (l.ref) {
      const p = await byBarcode(db, l.ref);
      if (p) {
        out.product = p;
        out.match = "barcode";
        if (p.status !== "IN_STOCK" && p.status !== "RESERVED") out.warnings.push(`${p.barcode} is ${p.status.replace(/_/g, " ").toLowerCase()}, not for sale.`);
        if (p.branchId !== branchId) out.warnings.push(`${p.barcode} belongs to another branch.`);
        if (mg && weightGap(p, mg) > SAME_WEIGHT_MG)
          out.warnings.push(`${p.barcode} weighs ${(p.netMg / 1000).toFixed(3)} g, but the bill says ${(mg / 1000).toFixed(3)} g. Check the barcode.`);
        if (used.has(p.id)) {
          out.warnings.push(`${p.barcode} is already on an earlier line.`);
          out.product = null;
          out.match = "none";
        }
      } else out.warnings.push(`No product has the barcode "${l.ref}".`);
    }

    // No barcode read (or an old tag number): offer stock near the weight, the best named first.
    if (!out.product && mg) {
      const near = (await nearWeight(db, branchId, mg)).filter((p) => !used.has(p.id));
      near.sort((a, b) => weightGap(a, mg) - weightGap(b, mg) || likeness(l.description, b.name) - likeness(l.description, a.name));
      out.candidates = near.slice(0, 5);
      const exact = near.filter((p) => weightGap(p, mg) <= SAME_WEIGHT_MG);
      // Pick by weight only when one piece fits; the till confirms it.
      if (exact.length === 1) {
        out.product = exact[0]!;
        out.match = "weight";
        out.warnings.push(`Matched by weight only (${out.product.barcode}). Check it is the right piece.`);
      } else if (exact.length > 1) out.warnings.push(`${exact.length} pieces in stock weigh ${(mg / 1000).toFixed(3)} g. Pick the right one.`);
      else if (!near.length) out.warnings.push("No piece in stock near this weight.");
    }
    if (out.product) used.add(out.product.id);
    lines.push(out);
  }

  return {
    ...bill,
    lines,
    customerMatch: bill.customer.phone ? await customerByPhone(db, bill.customer.phone) : null,
    categories,
    metalTypeId: metal?.id ?? null,
  };
}
