import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRatesCents } from "./rates";
import { assertCountLock } from "./counts";

export type MovementType =
  | "INTAKE"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "RETURN"
  | "LOSS"
  | "VOID"
  | "SALE_OUT";

const ALLOW: Record<string, string[]> = {
  IN_STOCK: ["TRANSFER_PENDING", "RETURNED", "LOST", "VOID", "SOLD"],
  TRANSFER_PENDING: ["IN_STOCK"],
  RETURNED: ["IN_STOCK", "VOID"],
  LOST: [],
  VOID: [],
  RESERVED: [],
  SOLD: ["RETURNED"],
  IN_REPAIR: [],
  IN_MANUFACTURING: [],
  MELTING: [],
  MELTED: [],
};

function checkTransition(from: string, to: string): void {
  if (!(ALLOW[from] ?? []).includes(to))
    throw Object.assign(new Error(`Transition ${from} → ${to} not available in this phase`), {
      code: "TRANSITION_LOCKED",
    });
}

export type MoveInput = {
  productId: string;
  toStatus: string;
  toBranchId?: string;
  reason?: string;
};

function moveStmt(
  db: D1Database,
  id: string,
  productId: string,
  type: MovementType,
  fromS: string | null,
  toS: string,
  fromB: string | null,
  toB: string | null,
  weightMg: number,
  reason: string | null,
  now: number,
  actorId: string
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, productId, type, fromS, toS, fromB, toB, weightMg, reason, now, actorId);
}

export async function buildMoveStmts(
  db: D1Database,
  productId: string,
  toStatus: string,
  opts: {
    toBranchId?: string;
    reason?: string;
    actorId: string;
    now: number;
    auditAction?: string;
  }
): Promise<{ stmts: D1PreparedStatement[]; branchId: string; netMg: number; fromStatus: string }> {
  const prev = await db
    .prepare("SELECT id, status, branch_id, net_mg FROM products WHERE id = ?")
    .bind(productId)
    .first<{ id: string; status: string; branch_id: string; net_mg: number }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  await assertCountLock(db, productId);
  checkTransition(prev.status, toStatus);
  if ((toStatus === "VOID" || toStatus === "LOST") && !opts.reason)
    throw Object.assign(new Error("Reason required for VOID/LOST"), { code: "VALIDATION" });
  const type: MovementType =
    toStatus === "VOID"
      ? "VOID"
      : toStatus === "LOST"
        ? "LOSS"
        : toStatus === "RETURNED"
          ? "RETURN"
          : toStatus === "SOLD"
            ? "SALE_OUT"
            : "TRANSFER_IN";
  const stmts = [
    db.prepare("UPDATE products SET status = ? WHERE id = ?").bind(toStatus, productId),
    moveStmt(
      db,
      crypto.randomUUID(),
      productId,
      type,
      prev.status,
      toStatus,
      prev.branch_id,
      prev.branch_id,
      prev.net_mg,
      opts.reason ?? null,
      opts.now,
      opts.actorId
    ),
    buildAuditStmt(db, {
      userId: opts.actorId,
      action: opts.auditAction ?? `inventory.${type.toLowerCase()}`,
      entity: "product",
      entityId: productId,
      prev: { status: prev.status },
      next: { status: toStatus },
      reason: opts.reason,
      branchId: prev.branch_id,
    }),
  ];
  return { stmts, branchId: prev.branch_id, netMg: prev.net_mg, fromStatus: prev.status };
}

export async function recordMovement(
  db: D1Database,
  input: MoveInput,
  actorId: string
): Promise<{ movementId: string }> {
  const prev = await db
    .prepare(
      "SELECT p.id, p.status, p.branch_id, p.net_mg, p.fine_gold_mg, p.purity_id, pu.permille FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id = ?"
    )
    .bind(input.productId)
    .first<{
      id: string;
      status: string;
      branch_id: string;
      net_mg: number;
      fine_gold_mg: number;
      purity_id: string;
      permille: number;
    }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  await assertCountLock(db, input.productId);
  if (input.toStatus === "SOLD")
    throw Object.assign(new Error("Sales must go through POST /sales/invoices"), { code: "CONFLICT" });
  if (input.toStatus === "LOST")
    throw Object.assign(new Error("Shortages must go through POST /counts (approve)"), { code: "CONFLICT" });
  if (input.toStatus === "VOID")
    throw Object.assign(new Error("Voids must go through PATCH /products/:id/void"), { code: "CONFLICT" });
  if (prev.status === "SOLD")
    throw Object.assign(new Error("Sold returns must go through POST /sales/returns"), { code: "CONFLICT" });
  checkTransition(prev.status, input.toStatus);
  const now = Date.now();

  if (input.toStatus === "TRANSFER_PENDING") {
    if (!input.toBranchId)
      throw Object.assign(new Error("toBranchId required for transfer"), { code: "VALIDATION" });
    const br = await db
      .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
      .bind(input.toBranchId)
      .first();
    if (!br) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
    if (input.toBranchId !== prev.branch_id)
      throw Object.assign(new Error("Cross-branch transfers must go through POST /transfers"), { code: "CONFLICT" });
    const inId = crypto.randomUUID();
    await db.batch([
      db.prepare("UPDATE products SET status = 'TRANSFER_PENDING' WHERE id = ?").bind(input.productId),
      moveStmt(db, crypto.randomUUID(), input.productId, "TRANSFER_OUT", prev.status, "TRANSFER_PENDING", prev.branch_id, input.toBranchId, prev.net_mg, input.reason ?? null, now, actorId),
      db.prepare("UPDATE products SET status = 'IN_STOCK', branch_id = ? WHERE id = ?").bind(input.toBranchId, input.productId),
      moveStmt(db, inId, input.productId, "TRANSFER_IN", "TRANSFER_PENDING", "IN_STOCK", prev.branch_id, input.toBranchId, prev.net_mg, input.reason ?? null, now, actorId),
      // The gold ledger is how the shop knows where its gold is. Without this
      // row the ledger keeps attributing the product to the origin branch
      // while products.branch_id has already moved, and gold_stock_consistency
      // fails for the destination by exactly the transferred weight.
      // Direction is the convention gold_stock_consistency reads: source is
      // the branch the gold left, destination is the branch it arrived at.
      db
        .prepare(
          "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'TRANSFER', ?, ?, ?, 'inventory_transfer', ?, ?, NULL, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          now,
          input.toBranchId,
          `branch:${prev.branch_id}`,
          `branch:${input.toBranchId}`,
          prev.net_mg,
          prev.permille,
          prev.fine_gold_mg,
          inId,
          input.productId,
          actorId,
          input.reason ?? null,
          now,
          actorId
        ),
      buildAuditStmt(db, {
        userId: actorId,
        action: "inventory.transfer",
        entity: "product",
        entityId: input.productId,
        prev: { status: prev.status, branch: prev.branch_id },
        next: { status: "IN_STOCK", branch: input.toBranchId },
        reason: input.reason,
        branchId: input.toBranchId,
      }),
    ]);
    return { movementId: inId };
  }

  const built = await buildMoveStmts(db, input.productId, input.toStatus, {
    reason: input.reason,
    actorId,
    now,
  });
  await db.batch(built.stmts);
  const row = await db
    .prepare("SELECT id FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(input.productId)
    .first<{ id: string }>();
  return { movementId: row?.id ?? "" };
}

export async function listMovements(
  db: D1Database,
  opts: PageOpts & { productId?: string; branchId?: string; type?: string }
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(m.type LIKE ? OR m.reason LIKE ?)"];
  const vals: unknown[] = [like, like];
  if (opts.productId) {
    conds.push("m.product_id = ?");
    vals.push(opts.productId);
  }
  if (opts.branchId) {
    conds.push("(m.from_branch = ? OR m.to_branch = ?)");
    vals.push(opts.branchId, opts.branchId);
  }
  if (opts.type) {
    conds.push("m.type = ?");
    vals.push(opts.type);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM stock_movements m ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT m.id, m.product_id, p.barcode, m.type, m.from_status, m.to_status, m.from_branch, m.to_branch, m.weight_mg, m.reason, m.created_at, m.created_by FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function stockSummary(
  db: D1Database,
  groupBy: "branch" | "purity" | "product"
): Promise<Record<string, unknown>[]> {
  const col = groupBy === "branch" ? "p.branch_id" : groupBy === "purity" ? "p.purity_id" : "p.id";
  const { results } = await db
    .prepare(
      `SELECT ${col} AS key, COUNT(*) AS pieces, SUM(p.net_mg) AS net_mg, SUM(p.fine_gold_mg) AS fine_mg FROM products p WHERE p.status = 'IN_STOCK' GROUP BY ${col} ORDER BY net_mg DESC`
    )
    .all();
  if (groupBy === "product") return results ?? [];
  const rates = await currentGoldRatesCents(db);
  const byPurity = new Map(rates.map((r) => [r.purity_id, r.rate_cents_per_g]));
  const { results: all } = await db
    .prepare(`SELECT branch_id, purity_id, net_mg FROM products WHERE status = 'IN_STOCK'`)
    .all<{ branch_id: string; purity_id: string; net_mg: number }>();
  const valByKey = new Map<string, number>();
  for (const row of all ?? []) {
    const k = groupBy === "branch" ? row.branch_id : row.purity_id;
    const rate = byPurity.get(row.purity_id) ?? 0;
    valByKey.set(k, (valByKey.get(k) ?? 0) + Math.round((row.net_mg * rate) / 1000));
  }
  return (results ?? []).map((r) => ({
    ...(r as object),
    value_cents: valByKey.get((r as { key: string }).key) ?? 0,
  }));
}

export type KaratLine = {
  purity_id: string;
  karat: string;
  permille: number;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  value_cents: number;
};

export type BranchLine = {
  branch_id: string;
  name: string;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  value_cents: number;
};

export type InventoryInsights = {
  totals: { pieces: number; net_mg: number; fine_mg: number; value_cents: number };
  byKarat: KaratLine[];
  byBranch: BranchLine[];
  attention: {
    transfer_pending: number;
    in_repair: number;
    reserved: number;
    last_movement_at: number | null;
    movements_24h: number;
  };
};

/**
 * One pricing rule for every stock value in the app. Kept in the same file as
 * stockSummary so the two can never drift: if this changes, both change.
 * A karat with no published rate contributes 0, not NaN — the UI has a
 * "no priced stock" state and must keep rendering.
 */
export function priceStock(netMg: number, rateCentsPerG: number | undefined): number {
  if (!rateCentsPerG) return 0;
  return Math.round((netMg * rateCentsPerG) / 1000);
}

type InsightRow = {
  group_key: string;
  branch_id: string;
  branch_name: string | null;
  karat: string;
  permille: number;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  value_cents: number | null;
};

type AttentionCounts = { transfer_pending: number; in_repair: number; reserved: number };

export async function inventoryInsights(db: D1Database): Promise<InventoryInsights> {
  const now = Date.now();
  const [{ results: rows }, counts, last, c24] = await Promise.all([
    // Value is rounded per product inside SQL, exactly as stockSummary does
    // in JS. Rounding after the GROUP BY would sum the aggregate weight first
    // and disagree with the stock table by a cent or two.
    db
      .prepare(
        `SELECT p.purity_id AS group_key, p.branch_id, b.name AS branch_name, pu.karat, pu.permille, COUNT(*) AS pieces, SUM(p.net_mg) AS net_mg, SUM(p.fine_gold_mg) AS fine_mg, SUM(ROUND(p.net_mg * COALESCE((SELECT g.rate_cents_per_g FROM gold_rates g WHERE g.purity_id = p.purity_id AND g.effective_from <= ? ORDER BY g.effective_from DESC LIMIT 1), 0) / 1000)) AS value_cents FROM products p JOIN purities pu ON pu.id = p.purity_id LEFT JOIN branches b ON b.id = p.branch_id WHERE p.status = 'IN_STOCK' GROUP BY p.purity_id, p.branch_id, pu.karat, pu.permille, b.name`
      )
      .bind(now)
      .all<InsightRow>(),
    db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE status = 'TRANSFER_PENDING') AS transfer_pending, COUNT(*) FILTER (WHERE status = 'IN_REPAIR') AS in_repair, COUNT(*) FILTER (WHERE status = 'RESERVED') AS reserved FROM products`
      )
      .first<AttentionCounts>(),
    db
      .prepare(`SELECT MAX(created_at) AS last FROM stock_movements`)
      .first<{ last: number | null }>(),
    db
      .prepare(`SELECT COUNT(*) AS c24 FROM stock_movements WHERE created_at >= ?`)
      .bind(now - 24 * 60 * 60 * 1000)
      .first<{ c24: number }>(),
  ]);

  const karat = new Map<string, KaratLine>();
  const branch = new Map<string, BranchLine>();
  const totals = { pieces: 0, net_mg: 0, fine_mg: 0, value_cents: 0 };

  for (const r of rows ?? []) {
    const pieces = Number(r.pieces ?? 0);
    const netMg = Number(r.net_mg ?? 0);
    const fineMg = Number(r.fine_mg ?? 0);
    const valueCents = Number(r.value_cents ?? 0);

    totals.pieces += pieces;
    totals.net_mg += netMg;
    totals.fine_mg += fineMg;
    totals.value_cents += valueCents;

    const k = karat.get(r.group_key) ?? {
      purity_id: r.group_key,
      karat: r.karat,
      permille: r.permille,
      pieces: 0,
      net_mg: 0,
      fine_mg: 0,
      value_cents: 0,
    };
    k.pieces += pieces;
    k.net_mg += netMg;
    k.fine_mg += fineMg;
    k.value_cents += valueCents;
    karat.set(r.group_key, k);

    const b = branch.get(r.branch_id) ?? {
      branch_id: r.branch_id,
      name: r.branch_name ?? r.branch_id,
      pieces: 0,
      net_mg: 0,
      fine_mg: 0,
      value_cents: 0,
    };
    b.pieces += pieces;
    b.net_mg += netMg;
    b.fine_mg += fineMg;
    b.value_cents += valueCents;
    branch.set(r.branch_id, b);
  }

  const byValue = (a: { value_cents: number }, b: { value_cents: number }) =>
    b.value_cents - a.value_cents;

  return {
    totals,
    byKarat: [...karat.values()].sort(byValue),
    byBranch: [...branch.values()].sort(byValue),
    attention: {
      transfer_pending: Number(counts?.transfer_pending ?? 0),
      in_repair: Number(counts?.in_repair ?? 0),
      reserved: Number(counts?.reserved ?? 0),
      last_movement_at: last?.last ?? null,
      movements_24h: Number(c24?.c24 ?? 0),
    },
  };
}
