import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRatesCents } from "./rates";

export type MovementType = "INTAKE" | "TRANSFER_OUT" | "TRANSFER_IN" | "RETURN" | "LOSS" | "VOID";

const ALLOW: Record<string, string[]> = {
  IN_STOCK: ["TRANSFER_PENDING", "RETURNED", "LOST", "VOID"],
  TRANSFER_PENDING: ["IN_STOCK"],
  RETURNED: ["IN_STOCK", "VOID"],
  LOST: [],
  VOID: [],
  RESERVED: [],
  SOLD: [],
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

export async function recordMovement(
  db: D1Database,
  input: MoveInput,
  actorId: string
): Promise<{ movementId: string }> {
  const prev = await db
    .prepare("SELECT id, status, branch_id, net_mg FROM products WHERE id = ?")
    .bind(input.productId)
    .first<{ id: string; status: string; branch_id: string; net_mg: number }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  checkTransition(prev.status, input.toStatus);
  if ((input.toStatus === "VOID" || input.toStatus === "LOST") && !input.reason)
    throw Object.assign(new Error("Reason required for VOID/LOST"), { code: "VALIDATION" });
  const now = Date.now();

  if (input.toStatus === "TRANSFER_PENDING") {
    if (!input.toBranchId)
      throw Object.assign(new Error("toBranchId required for transfer"), { code: "VALIDATION" });
    const br = await db
      .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
      .bind(input.toBranchId)
      .first();
    if (!br) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
    const inId = crypto.randomUUID();
    await db.batch([
      db.prepare("UPDATE products SET status = 'TRANSFER_PENDING' WHERE id = ?").bind(input.productId),
      moveStmt(db, crypto.randomUUID(), input.productId, "TRANSFER_OUT", prev.status, "TRANSFER_PENDING", prev.branch_id, input.toBranchId, prev.net_mg, input.reason ?? null, now, actorId),
      db.prepare("UPDATE products SET status = 'IN_STOCK', branch_id = ? WHERE id = ?").bind(input.toBranchId, input.productId),
      moveStmt(db, inId, input.productId, "TRANSFER_IN", "TRANSFER_PENDING", "IN_STOCK", prev.branch_id, input.toBranchId, prev.net_mg, input.reason ?? null, now, actorId),
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

  const type: MovementType =
    input.toStatus === "VOID"
      ? "VOID"
      : input.toStatus === "LOST"
        ? "LOSS"
        : input.toStatus === "RETURNED"
          ? "RETURN"
          : "TRANSFER_IN";
  const moveId = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE products SET status = ? WHERE id = ?").bind(input.toStatus, input.productId),
    moveStmt(db, moveId, input.productId, type, prev.status, input.toStatus, prev.branch_id, prev.branch_id, prev.net_mg, input.reason ?? null, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: `inventory.${type.toLowerCase()}`,
      entity: "product",
      entityId: input.productId,
      prev: { status: prev.status },
      next: { status: input.toStatus },
      reason: input.reason,
      branchId: prev.branch_id,
    }),
  ]);
  return { movementId: moveId };
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
