// Products come from old gold on hand. A new piece draws its metal weight from
// the branch's old gold, and that weight leaves the old gold item it came from.
//
// Which old gold can feed a piece:
// - an item of the same karat: its fine weight and book cost move to the piece,
//   so stock value and gold stay where they were (the same as converting an item);
// - an item with no karat yet: its weight is drawn, and the metal enters the gold
//   ledger at the piece's karat, the same as a direct intake. Its fine and cost were
//   never booked, so nothing is taken from them.
// Items held for a live custom order are never drawn.
import { fineGoldMg } from "@goldos/shared";
import { postGoldStmts } from "./gold";
import { staleGuard } from "./guard";

export type DrawRequest = { netMg: number; permille: number };

/** One old gold item the piece takes weight from. `expectedNetMg` is the item's weight just before this draw. */
export type DrawAllocation = {
  itemId: string;
  netMg: number;
  fineMg: number;
  costCents: number;
  expectedNetMg: number;
  matched: boolean;
};

/** What one piece draws: its allocations, and the gold it brings in new (the unknown-karat part). */
export type PieceDraw = {
  netMg: number;
  permille: number;
  allocations: DrawAllocation[];
  /** Fine and cost already held by the matching-karat items the piece draws from. */
  matchedFineMg: number;
  matchedCostCents: number;
  /** Weight drawn from items with no karat yet; its fine is booked at the piece's karat. */
  unknownMg: number;
};

type PoolItem = {
  id: string;
  netLeft: number;
  fineLeft: number;
  costLeft: number;
  permille: number | null;
};

const POOL_FILTER = `o.status = 'AVAILABLE' AND o.net_mg > 0
  AND NOT EXISTS (
    SELECT 1 FROM custom_order_gold g JOIN custom_orders co ON co.id = g.order_id
    WHERE g.kind = 'CUSTOMER_OLDGOLD' AND g.ref_id = o.id AND co.status NOT IN ('CANCELLED', 'DELIVERED')
  )`;

export function mgLabel(mg: number): string {
  return `${(mg / 1000).toFixed(3).replace(/\.?0+$/, "")} g`;
}

async function loadPool(db: D1Database, branchId: string): Promise<PoolItem[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.net_mg, o.fine_mg, o.purchase_value_cents, o.tested_permille
       FROM old_gold_items o
       WHERE o.branch_id = ? AND ${POOL_FILTER}
       ORDER BY o.created_at, o.id`
    )
    .bind(branchId)
    .all<{ id: string; net_mg: number; fine_mg: number; purchase_value_cents: number | null; tested_permille: number | null }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    netLeft: r.net_mg,
    fineLeft: r.fine_mg,
    costLeft: r.purchase_value_cents ?? 0,
    permille: r.tested_permille,
  }));
}

/**
 * Plans where each piece's metal comes from, in order: items of the piece's karat
 * first, then items with no karat yet. Throws when the branch has too little old
 * gold for a piece. Pieces planned later see the weight the earlier ones took.
 */
export async function planOldGoldDraws(db: D1Database, branchId: string, requests: DrawRequest[]): Promise<PieceDraw[]> {
  const pool = await loadPool(db, branchId);
  return requests.map((req) => {
    const candidates = [
      ...pool.filter((it) => it.permille === req.permille),
      ...pool.filter((it) => it.permille === null),
    ];
    const usable = candidates.reduce((n, it) => n + it.netLeft, 0);
    if (usable < req.netMg)
      throw Object.assign(
        new Error(`Not enough old gold on hand: ${mgLabel(usable)} is left and this piece needs ${mgLabel(req.netMg)}`),
        { code: "VALIDATION" }
      );
    const allocations: DrawAllocation[] = [];
    let need = req.netMg;
    for (const it of candidates) {
      if (need === 0) break;
      if (it.netLeft === 0) continue;
      const netMg = Math.min(need, it.netLeft);
      // The last of an item's weight takes the rest of its fine and cost, so nothing is left behind by rounding.
      const whole = netMg === it.netLeft;
      const fineMg = whole ? it.fineLeft : Math.round((it.fineLeft * netMg) / it.netLeft);
      const costCents = whole ? it.costLeft : Math.round((it.costLeft * netMg) / it.netLeft);
      allocations.push({
        itemId: it.id,
        netMg,
        fineMg: it.permille === null ? 0 : fineMg,
        costCents: it.permille === null ? 0 : costCents,
        expectedNetMg: it.netLeft,
        matched: it.permille !== null,
      });
      it.netLeft -= netMg;
      it.fineLeft -= fineMg;
      it.costLeft -= costCents;
      need -= netMg;
    }
    const matched = allocations.filter((a) => a.matched);
    const unknown = allocations.filter((a) => !a.matched);
    return {
      netMg: req.netMg,
      permille: req.permille,
      allocations,
      matchedFineMg: matched.reduce((n, a) => n + a.fineMg, 0),
      matchedCostCents: matched.reduce((n, a) => n + a.costCents, 0),
      unknownMg: unknown.reduce((n, a) => n + a.netMg, 0),
    };
  });
}

/** Old gold on hand at a branch: weight by karat, and the part with no karat yet. */
export async function oldGoldOnHand(db: D1Database, branchId: string) {
  const { results } = await db
    .prepare(
      `SELECT o.tested_permille AS permille, o.karat AS karat, SUM(o.net_mg) AS net_mg
       FROM old_gold_items o
       WHERE o.branch_id = ? AND ${POOL_FILTER}
       GROUP BY o.tested_permille, o.karat
       ORDER BY o.tested_permille DESC`
    )
    .bind(branchId)
    .all<{ permille: number | null; karat: string | null; net_mg: number }>();
  const rows = results ?? [];
  return {
    totalMg: rows.reduce((n, r) => n + r.net_mg, 0),
    unknownMg: rows.filter((r) => r.permille === null).reduce((n, r) => n + r.net_mg, 0),
    byKarat: rows
      .filter((r) => r.permille !== null)
      .map((r) => ({ permille: r.permille as number, karat: r.karat ?? "", netMg: r.net_mg })),
  };
}

/**
 * The rows that take a piece's metal out of its old gold items, and record the draw.
 * The product row must come before these in the same batch (the draw names it).
 */
export function drawStmts(db: D1Database, draw: PieceDraw, productId: string, actorId: string, now: number): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  for (const a of draw.allocations) {
    stmts.push(
      db
        .prepare(
          `UPDATE old_gold_items
           SET gross_mg = gross_mg - ?, net_mg = net_mg - ?, fine_mg = fine_mg - ?,
               purchase_value_cents = purchase_value_cents - ?,
               status = CASE WHEN net_mg - ? = 0 THEN 'DRAWN' ELSE status END
           WHERE id = ? AND status = 'AVAILABLE' AND net_mg = ?`
        )
        .bind(a.netMg, a.netMg, a.fineMg, a.costCents, a.netMg, a.itemId, a.expectedNetMg),
      staleGuard(db)
    );
    stmts.push(
      db
        .prepare(
          "INSERT INTO old_gold_draws (id, product_id, old_gold_id, net_mg, fine_mg, cost_cents, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(crypto.randomUUID(), productId, a.itemId, a.netMg, a.fineMg, a.costCents, now, actorId)
    );
  }
  return stmts;
}

/** The gold ledger row for a piece's unknown-karat part: it enters the books at the piece's karat. */
export async function unknownGoldEntry(
  db: D1Database,
  draw: PieceDraw,
  productId: string,
  branchId: string,
  barcode: string,
  actorId: string
): Promise<D1PreparedStatement[]> {
  if (draw.unknownMg === 0) return [];
  return postGoldStmts(
    db,
    [
      {
        branchId,
        source: "opening",
        destination: `branch:${branchId}`,
        type: "OPENING",
        weightMg: draw.unknownMg,
        permille: draw.permille,
        refEntity: "product_intake",
        refId: productId,
        productId,
        notes: `Drawn from old gold, direct intake ${barcode}`,
      },
    ],
    { actorId, auditAction: "product.intake.gold", auditEntity: "product", auditEntityId: productId, branchId }
  );
}

/** Fine weight of a piece built from old gold: what its matching items held, plus the unknown part at its karat. */
export function drawnFineMg(draw: PieceDraw): number {
  return draw.matchedFineMg + fineGoldMg(draw.unknownMg, draw.permille);
}

/** Puts back what a voided piece drew: the weight, fine and cost return to the items it came from. */
export async function returnDrawStmts(db: D1Database, productId: string, actorId: string, now: number): Promise<D1PreparedStatement[]> {
  const { results } = await db
    .prepare("SELECT id, old_gold_id, net_mg, fine_mg, cost_cents FROM old_gold_draws WHERE product_id = ? AND reversed_at IS NULL")
    .bind(productId)
    .all<{ id: string; old_gold_id: string; net_mg: number; fine_mg: number; cost_cents: number }>();
  const stmts: D1PreparedStatement[] = [];
  for (const d of results ?? []) {
    stmts.push(
      db
        .prepare(
          `UPDATE old_gold_items
           SET gross_mg = gross_mg + ?, net_mg = net_mg + ?, fine_mg = fine_mg + ?,
               purchase_value_cents = purchase_value_cents + ?,
               status = CASE WHEN status = 'DRAWN' THEN 'AVAILABLE' ELSE status END
           WHERE id = ?`
        )
        .bind(d.net_mg, d.net_mg, d.fine_mg, d.cost_cents, d.old_gold_id),
      db.prepare("UPDATE old_gold_draws SET reversed_at = ? WHERE id = ?").bind(now, d.id)
    );
  }
  return stmts;
}

/** Book cost a piece took from its old gold items (not reversed). */
export async function drawnCostCents(db: D1Database, productId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(cost_cents), 0) AS n FROM old_gold_draws WHERE product_id = ? AND reversed_at IS NULL")
    .bind(productId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function hasDraws(db: D1Database, productId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM old_gold_draws WHERE product_id = ? AND reversed_at IS NULL LIMIT 1")
    .bind(productId)
    .first();
  return !!row;
}
