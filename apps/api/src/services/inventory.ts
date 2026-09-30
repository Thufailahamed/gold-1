import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRatesCents } from "./rates";
import { assertCountLock } from "./counts";
import { tzOffsetMinutes } from "./busdate";

export type MovementType =
  | "INTAKE"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "RETURN"
  | "LOSS"
  | "VOID"
  | "SALE_OUT"
  | "RESTOCK"
  | "RESERVE"
  | "RELEASE";

/**
 * Statuses in which a finished piece is physically on hand at its branch and
 * counts as stock: on the shelf, or set aside for a customer. Held-gold
 * reconciliation already counts both (it excludes only the exits).
 */
export const ON_HAND_STATUSES = ["IN_STOCK", "RESERVED"] as const;
export const ON_HAND_SQL = ON_HAND_STATUSES.map((s) => `'${s}'`).join(",");

/** Nulls every reservation column; applied whenever a piece leaves RESERVED. */
const CLEAR_RESERVATION =
  "reserved_customer_id = NULL, reserved_note = NULL, reserved_until = NULL, reserved_at = NULL, reserved_by = NULL";

/** SQL fragment + binds restricting a column to the caller's branches (null = all). */
function scopeCond(col: string, scope: string[] | null): { sql: string; vals: string[] } {
  if (scope === null) return { sql: "", vals: [] };
  if (scope.length === 0) return { sql: " AND 1 = 0", vals: [] };
  return { sql: ` AND ${col} IN (${scope.map(() => "?").join(",")})`, vals: scope };
}

const ALLOW: Record<string, string[]> = {
  IN_STOCK: ["TRANSFER_PENDING", "RETURNED", "LOST", "VOID", "SOLD", "RESERVED"],
  TRANSFER_PENDING: ["IN_STOCK"],
  RETURNED: ["IN_STOCK", "VOID"],
  LOST: [],
  VOID: [],
  // A hold ends one of two ways: released back to the shelf, or sold to the
  // customer it was held for (receiveSale enforces who).
  RESERVED: ["IN_STOCK", "SOLD"],
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
            : toStatus === "RESERVED"
              ? "RESERVE"
              : toStatus === "IN_STOCK"
                ? prev.status === "RESERVED"
                  ? "RELEASE"
                  : "RESTOCK"
                : "TRANSFER_IN";
  // Leaving RESERVED by any route (release, sale) ends the hold with it, so a
  // sold or restocked piece never carries a stale "held for" customer.
  const update =
    prev.status === "RESERVED" && toStatus !== "RESERVED"
      ? `UPDATE products SET status = ?, ${CLEAR_RESERVATION} WHERE id = ?`
      : "UPDATE products SET status = ? WHERE id = ?";
  const stmts = [
    db.prepare(update).bind(toStatus, productId),
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
  if (input.toStatus === "RESERVED" || prev.status === "RESERVED")
    throw Object.assign(new Error("Reservations must go through POST /products/:id/reserve and /release"), { code: "CONFLICT" });
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

export type ReserveInput = {
  customerId: string;
  note: string;
  /** Last business day of the hold, YYYY-MM-DD in the shop's time zone. */
  untilDate?: string;
};

/**
 * Sets a shelf piece aside for one customer. The piece stays on hand (counts,
 * stock value and held gold all still include it) but only that customer can
 * buy it until the hold is released. No money moves: an advance against the
 * piece is a customer receipt, not part of the hold.
 */
export async function reserveProduct(
  db: D1Database,
  productId: string,
  input: ReserveInput,
  actorId: string
): Promise<{ reservedUntil: number | null }> {
  const note = input.note.trim();
  if (!note) throw Object.assign(new Error("A note is required"), { code: "VALIDATION" });
  const customer = await db
    .prepare("SELECT id, name FROM customers WHERE id = ? AND is_active = 1")
    .bind(input.customerId)
    .first<{ id: string; name: string }>();
  if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  const now = Date.now();
  let until: number | null = null;
  if (input.untilDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.untilDate);
    if (!m) throw Object.assign(new Error("untilDate must be YYYY-MM-DD"), { code: "VALIDATION" });
    // End of that business day, expressed in UTC epoch ms.
    until =
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999) -
      (await tzOffsetMinutes(db)) * 60_000;
    if (Number.isNaN(until) || until < now)
      throw Object.assign(new Error("Hold date must be today or later"), { code: "VALIDATION" });
  }
  const reason = `Reserved for ${customer.name}: ${note}`;
  const built = await buildMoveStmts(db, productId, "RESERVED", {
    reason,
    actorId,
    now,
    auditAction: "product.reserve",
  });
  await db.batch([
    ...built.stmts,
    db
      .prepare(
        "UPDATE products SET reserved_customer_id = ?, reserved_note = ?, reserved_until = ?, reserved_at = ?, reserved_by = ? WHERE id = ? AND status = 'RESERVED'"
      )
      .bind(customer.id, note, until, now, actorId, productId),
  ]);
  return { reservedUntil: until };
}

/** Ends a hold and puts the piece back on the shelf for anyone to buy. */
export async function releaseReservation(
  db: D1Database,
  productId: string,
  reason: string | undefined,
  actorId: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT status FROM products WHERE id = ?")
    .bind(productId)
    .first<{ status: string }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (prev.status !== "RESERVED")
    throw Object.assign(new Error("Product is not reserved"), { code: "CONFLICT" });
  const built = await buildMoveStmts(db, productId, "IN_STOCK", {
    reason: reason?.trim() || "Reservation released",
    actorId,
    now: Date.now(),
    auditAction: "product.release",
  });
  await db.batch(built.stmts);
}

export async function listMovements(
  db: D1Database,
  opts: PageOpts & { productId?: string; branchId?: string; type?: string; scope?: string[] | null }
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
  if (opts.scope !== undefined && opts.scope !== null) {
    if (opts.scope.length === 0) conds.push("1 = 0");
    else {
      const qs = opts.scope.map(() => "?").join(",");
      conds.push(`(m.from_branch IN (${qs}) OR m.to_branch IN (${qs}))`);
      vals.push(...opts.scope, ...opts.scope);
    }
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM stock_movements m ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT m.id, m.product_id, p.barcode, p.name AS product_name, m.type, m.from_status, m.to_status, m.from_branch, m.to_branch, m.weight_mg, m.reason, m.created_at, m.created_by FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function stockSummary(
  db: D1Database,
  groupBy: "branch" | "purity" | "product",
  scope: string[] | null = null,
  branchId?: string
): Promise<Record<string, unknown>[]> {
  const col = groupBy === "branch" ? "p.branch_id" : groupBy === "purity" ? "p.purity_id" : "p.id";
  // Grouping by product is one row per piece, so its name and barcode are
  // well-defined and let the table show something a person can recognise.
  // Branch and purity groups carry their display name so the table never has
  // to show a raw id.
  const extra =
    groupBy === "product"
      ? ", p.name AS name, p.barcode AS barcode"
      : groupBy === "branch"
        ? ", (SELECT b.name FROM branches b WHERE b.id = p.branch_id) AS name"
        : ", (SELECT pu.karat FROM purities pu WHERE pu.id = p.purity_id) AS name";
  const sc = scopeCond("p.branch_id", scope);
  const bf = branchId ? " AND p.branch_id = ?" : "";
  const binds = [...sc.vals, ...(branchId ? [branchId] : [])];
  const { results } = await db
    .prepare(
      `SELECT ${col} AS key${extra}, COUNT(*) AS pieces, SUM(p.net_mg) AS net_mg, SUM(p.fine_gold_mg) AS fine_mg FROM products p WHERE p.status IN (${ON_HAND_SQL})${sc.sql}${bf} GROUP BY ${col} ORDER BY net_mg DESC`
    )
    .bind(...binds)
    .all();
  const rates = await currentGoldRatesCents(db);
  const byPurity = new Map(rates.map((r) => [r.purity_id, r.rate_cents_per_g]));
  const { results: all } = await db
    .prepare(`SELECT id, branch_id, purity_id, net_mg FROM products p WHERE status IN (${ON_HAND_SQL})${sc.sql}${bf}`)
    .bind(...binds)
    .all<{ id: string; branch_id: string; purity_id: string; net_mg: number }>();
  const valByKey = new Map<string, number>();
  for (const row of all ?? []) {
    const k = groupBy === "branch" ? row.branch_id : groupBy === "purity" ? row.purity_id : row.id;
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

export async function inventoryInsights(db: D1Database, scope: string[] | null = null): Promise<InventoryInsights> {
  const now = Date.now();
  const sc = scopeCond("p.branch_id", scope);
  const scP = scopeCond("branch_id", scope);
  const scM = scope === null ? { sql: "", vals: [] as string[] } : scope.length === 0 ? { sql: " AND 1 = 0", vals: [] as string[] } : { sql: ` AND (from_branch IN (${scope.map(() => "?").join(",")}) OR to_branch IN (${scope.map(() => "?").join(",")}))`, vals: [...scope, ...scope] };
  const [{ results: rows }, counts, last, c24] = await Promise.all([
    // Value is rounded per product inside SQL, exactly as stockSummary does
    // in JS. Rounding after the GROUP BY would sum the aggregate weight first
    // and disagree with the stock table by a cent or two.
    db
      .prepare(
        `SELECT p.purity_id AS group_key, p.branch_id, b.name AS branch_name, pu.karat, pu.permille, COUNT(*) AS pieces, SUM(p.net_mg) AS net_mg, SUM(p.fine_gold_mg) AS fine_mg, SUM(ROUND(p.net_mg * COALESCE((SELECT g.rate_cents_per_g FROM gold_rates g WHERE g.purity_id = p.purity_id AND g.effective_from <= ? ORDER BY g.effective_from DESC LIMIT 1), 0) / 1000)) AS value_cents FROM products p JOIN purities pu ON pu.id = p.purity_id LEFT JOIN branches b ON b.id = p.branch_id WHERE p.status IN (${ON_HAND_SQL})${sc.sql} GROUP BY p.purity_id, p.branch_id, pu.karat, pu.permille, b.name`
      )
      .bind(now, ...sc.vals)
      .all<InsightRow>(),
    db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE status = 'TRANSFER_PENDING') AS transfer_pending, COUNT(*) FILTER (WHERE status = 'IN_REPAIR') AS in_repair, COUNT(*) FILTER (WHERE status = 'RESERVED') AS reserved FROM products WHERE 1 = 1${scP.sql}`
      )
      .bind(...scP.vals)
      .first<AttentionCounts>(),
    db
      .prepare(`SELECT MAX(created_at) AS last FROM stock_movements WHERE 1 = 1${scM.sql}`)
      .bind(...scM.vals)
      .first<{ last: number | null }>(),
    db
      .prepare(`SELECT COUNT(*) AS c24 FROM stock_movements WHERE created_at >= ?${scM.sql}`)
      .bind(now - 24 * 60 * 60 * 1000, ...scM.vals)
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
