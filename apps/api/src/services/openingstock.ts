import { businessDateFor } from "./busdate";
import { buildEntryStmts } from "./journal";
import { postGoldStmts } from "./gold";

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

export type IntakeBackfillPosted = {
  productId: string;
  barcode: string;
  type: string;
  refId: string;
  fineMg: number;
};

export type IntakeBackfillReport = {
  posted: IntakeBackfillPosted[];
  skipped: { productId: string; reason: string }[];
};

/**
 * Bring direct-intake products that predate OPENING gold-row posting onto the
 * gold ledger. The shop's shelf from day one (created straight on Products,
 * with no purchase invoice or manufacturing order) had no inflow posted, so
 * `gold_stock_consistency` — a close gate — failed by exactly their fine
 * weight and every day close was blocked. Sold (and other exited) pieces are
 * included on purpose: their exit rows already left the ledger, so the
 * missing intake is what keeps it out of balance. Idempotent: only products
 * with no product_intake row are posted, so it can be re-run safely. VOID
 * products are skipped — they hold nothing and their intake would have been
 * reversed by the void flow.
 *
 * A second gap the same deployments left behind is a *received purchase
 * invoice whose PURCHASE gold row was never written* (the money journal was,
 * so only the metal is missing). The OPENING bucket correctly skips those
 * products — an invoice document owns their intake — so the invoice bucket
 * here posts the PURCHASE row the day cross-foot matches it against.
 */
export async function backfillIntakeLedger(
  db: D1Database,
  actorId: string
): Promise<IntakeBackfillReport> {
  const posted: IntakeBackfillPosted[] = [];
  const skipped: { productId: string; reason: string }[] = [];
  const stmts: D1PreparedStatement[] = [];

  // Bucket 1: direct intakes with no intake row on the books.
  const direct = await db
    .prepare(
      `SELECT p.id, p.barcode, p.branch_id, p.net_mg, pu.permille, p.created_at FROM products p
       JOIN purities pu ON pu.id = p.purity_id
       WHERE p.status <> 'VOID' AND p.net_mg > 0
         AND NOT EXISTS (SELECT 1 FROM gold_ledger g WHERE g.ref_entity = 'product_intake' AND g.ref_id = p.id)
         -- bought or manufactured pieces left through their own postings:
         -- they are not intakes and must not get one.
         AND NOT EXISTS (SELECT 1 FROM purchase_invoice_items pi WHERE pi.product_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM manufacturing_outputs mo WHERE mo.product_id = p.id)`
    )
    .all<{ id: string; barcode: string; branch_id: string; net_mg: number; permille: number; created_at: number }>();
  for (const p of direct.results ?? []) {
    try {
      stmts.push(
        ...(await postGoldStmts(
          db,
          [
            {
              occurredAt: p.created_at,
              branchId: p.branch_id,
              source: "opening",
              destination: `branch:${p.branch_id}`,
              type: "OPENING",
              weightMg: p.net_mg,
              permille: p.permille,
              refEntity: "product_intake",
              refId: p.id,
              productId: p.id,
              notes: `Backfill of direct intake ${p.barcode}`,
            },
          ],
          { actorId, auditAction: "product.intake.gold.backfill", auditEntity: "product", auditEntityId: p.id, branchId: p.branch_id }
        ))
      );
      posted.push({ productId: p.id, barcode: p.barcode, type: "OPENING", refId: p.id, fineMg: Math.round((p.net_mg * p.permille) / 1000) });
    } catch (e) {
      skipped.push({ productId: p.id, reason: (e as Error).message });
    }
  }

  // Bucket 2: received invoices whose PURCHASE rows never landed.
  const invoices = await db
    .prepare(
      `SELECT pi.id, pi.number, pi.branch_id, pi.created_at
       FROM purchase_invoices pi
       WHERE pi.status NOT IN ('VOID','DRAFT')
         AND NOT EXISTS (
           SELECT 1 FROM gold_ledger g
           WHERE g.ref_entity = 'purchase_invoice' AND g.ref_id = pi.id AND g.type = 'PURCHASE'
         )`
    )
    .all<{ id: string; number: string; branch_id: string; created_at: number }>();
  for (const inv of invoices.results ?? []) {
    const items = await db
      .prepare(
        `SELECT it.id, it.product_id, it.net_mg, pu.permille, p.barcode FROM purchase_invoice_items it
         JOIN purities pu ON pu.id = it.purity_id
         JOIN products p ON p.id = it.product_id
         WHERE it.invoice_id = ?`
      )
      .bind(inv.id)
      .all<{ id: string; product_id: string; net_mg: number; permille: number; barcode: string }>();
    for (const it of items.results ?? []) {
      try {
        stmts.push(
          ...(await postGoldStmts(
            db,
            [
              {
                occurredAt: inv.created_at,
                branchId: inv.branch_id,
                source: `purchase:${inv.number}`,
                destination: `branch:${inv.branch_id}`,
                type: "PURCHASE",
                weightMg: it.net_mg,
                permille: it.permille,
                refEntity: "purchase_invoice",
                refId: inv.id,
                productId: it.product_id,
                notes: `Backfill of Purchase ${inv.number}`,
              },
            ],
            { actorId, auditAction: "purchase.intake.gold.backfill", auditEntity: "purchase_invoice", auditEntityId: inv.id, branchId: inv.branch_id }
          ))
        );
        posted.push({ productId: it.product_id, barcode: it.barcode, type: "PURCHASE", refId: inv.id, fineMg: Math.round((it.net_mg * it.permille) / 1000) });
      } catch (e) {
        skipped.push({ productId: it.product_id, reason: (e as Error).message });
      }
    }
  }

  if (stmts.length) await db.batch(stmts);
  return { posted, skipped };
}
