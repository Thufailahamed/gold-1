import { businessDateFor } from "./busdate";
import { buildEntryStmts } from "./journal";

const INVENTORY = "1100";
const OPENING = "3100";

/**
 * Stock taken in directly — the shop's existing shelf on day one, or a piece
 * with no purchase or manufacturing document behind it — has no supplier to
 * owe and no cash that moved. Its book cost enters inventory against 3100
 * Opening Balances, so 1100 carries it and its sale's COGS credit has
 * something to come off. Without this, 1100 understated by every such piece
 * until it sold, and then went negative.
 *
 * Every opening-stock entry for a product shares ref_entity 'opening_stock'
 * and ref_id = the product, so the value it currently carries is their net.
 */
export async function carriedOpeningValue(db: D1Database, productId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.ref_entity = 'opening_stock' AND e.ref_id = ? AND l.account_code = '${INVENTORY}'`
    )
    .bind(productId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Was this product taken in directly (not bought, not manufactured)? */
export async function isDirectIntake(db: D1Database, productId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM gold_ledger WHERE ref_entity = 'product_intake' AND ref_id = ? LIMIT 1")
    .bind(productId)
    .first();
  return !!row;
}

/**
 * The entry that moves a direct-intake product's carried value by `deltaCents`
 * (positive: more inventory; negative: less). Null when there is nothing to
 * post. Used at intake (delta = cost), on a cost correction (delta = new −
 * carried) and on a void (delta = −carried).
 */
export async function buildOpeningStockStmts(
  db: D1Database,
  p: { productId: string; barcode: string; branchId: string; deltaCents: number; actorId: string; reason: string; entryDate?: string }
): Promise<{ stmts: D1PreparedStatement[]; entryNo: string } | null> {
  if (!p.deltaCents) return null;
  const amt = Math.abs(p.deltaCents);
  const up = p.deltaCents > 0;
  const built = await buildEntryStmts(
    db,
    {
      lines: [
        { account: INVENTORY, debitCents: up ? amt : 0, creditCents: up ? 0 : amt },
        { account: OPENING, debitCents: up ? 0 : amt, creditCents: up ? amt : 0 },
      ],
      refEntity: "opening_stock",
      refId: p.productId,
      refNo: p.barcode,
      memo: `Opening stock ${p.barcode}: ${p.reason}`,
      branchId: p.branchId,
      actorId: p.actorId,
      auditAction: "inventory.opening_stock",
      auditEntity: "product",
      auditEntityId: p.productId,
      sourceModule: "inventory",
    },
    { entryDate: p.entryDate ?? (await businessDateFor(db, Date.now())) }
  );
  return { stmts: built.stmts, entryNo: built.entryNo };
}

/**
 * Bring products taken in before opening-stock posting existed onto the
 * books. Idempotent: a product whose carried value already equals its cost
 * is skipped, so it can be re-run safely. Sold products are included on
 * purpose — their sale already credited 1100 by the cost, and this is the
 * debit that sale was missing. A product that fails (e.g. its branch's day is
 * closed) is reported, not fatal.
 */
export async function backfillOpeningStock(
  db: D1Database,
  actorId: string
): Promise<{ posted: { productId: string; barcode: string; cents: number; entryNo: string }[]; skipped: { productId: string; reason: string }[] }> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.id, p.barcode, p.branch_id, p.cost_cents FROM products p
       JOIN gold_ledger g ON g.ref_entity = 'product_intake' AND g.ref_id = p.id
       WHERE p.status <> 'VOID' AND p.cost_cents IS NOT NULL AND p.cost_cents > 0`
    )
    .all<{ id: string; barcode: string; branch_id: string; cost_cents: number }>();
  const posted: { productId: string; barcode: string; cents: number; entryNo: string }[] = [];
  const skipped: { productId: string; reason: string }[] = [];
  for (const p of results ?? []) {
    const delta = p.cost_cents - (await carriedOpeningValue(db, p.id));
    if (delta === 0) continue;
    try {
      const built = await buildOpeningStockStmts(db, {
        productId: p.id,
        barcode: p.barcode,
        branchId: p.branch_id,
        deltaCents: delta,
        actorId,
        reason: "backfill of direct intake",
      });
      if (!built) continue;
      await db.batch(built.stmts);
      posted.push({ productId: p.id, barcode: p.barcode, cents: delta, entryNo: built.entryNo });
    } catch (e) {
      skipped.push({ productId: p.id, reason: (e as Error).message });
    }
  }
  return { posted, skipped };
}
