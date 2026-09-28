import { fineGoldMg, gToMg, lkrToCents, type CreateMfgOrderInput, type ProduceMfgInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { postGoldStmts } from "./gold";
import { buildCreateProductStmts } from "./products";
import { currentGoldRatesCents } from "./rates";
import { getSetting } from "./settings";

async function nextMO(db: D1Database, stmts: D1PreparedStatement[]): Promise<string> {
  const row = await db
    .prepare("SELECT next FROM counters WHERE name = 'MO'")
    .bind()
    .first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'MO'").bind(row.next + 1));
  return `MO-${String(row.next).padStart(6, "0")}`;
}

async function requireMfgApprover(db: D1Database, approverId: string, actorId: string): Promise<void> {
  if (approverId === actorId)
    throw Object.assign(new Error("Approver cannot be yourself"), { code: "FORBIDDEN" });
  const target = await db
    .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1")
    .bind(approverId)
    .first();
  if (!target) throw Object.assign(new Error("Approver not found"), { code: "NOT_FOUND" });
  const { results } = await db
    .prepare(
      `SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`
    )
    .bind(approverId)
    .all<{ name: string }>();
  if (!(results ?? []).some((r) => r.name === "mfg:approve"))
    throw Object.assign(new Error("Approval requires mfg:approve"), { code: "FORBIDDEN" });
}

type OrderRow = {
  id: string;
  number: string;
  type: string;
  customer_id: string | null;
  branch_id: string;
  design: string;
  status: string;
  labour_cents: number;
  making_cents: number;
  stone_cost_cents: number;
  loss_mg: number;
};

async function loadOrder(db: D1Database, id: string): Promise<OrderRow> {
  const row = await db.prepare("SELECT * FROM manufacturing_orders WHERE id = ?").bind(id).first<OrderRow>();
  if (!row) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  return row;
}

async function allocatedFine(db: D1Database, orderId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(fine_mg), 0) AS t FROM manufacturing_materials WHERE order_id = ?")
    .bind(orderId)
    .first<{ t: number }>();
  return row?.t ?? 0;
}

async function lotRemaining(db: D1Database, lotBatchId: string, lotNumber: string): Promise<{ fineMg: number; branchId: string }> {
  const lot = await db
    .prepare("SELECT o.fine_mg, b.branch_id, b.status FROM melting_outputs o JOIN melting_batches b ON b.id = o.batch_id WHERE o.batch_id = ? AND o.lot_number = ?")
    .bind(lotBatchId, lotNumber)
    .first<{ fine_mg: number; branch_id: string; status: string }>();
  if (!lot) throw Object.assign(new Error(`Lot not found: ${lotNumber}`), { code: "NOT_FOUND" });
  if (lot.status !== "APPROVED")
    throw Object.assign(new Error(`Lot not from an approved batch: ${lotNumber}`), { code: "VALIDATION" });
  const used = await db
    .prepare("SELECT COALESCE(SUM(m.fine_mg), 0) AS t FROM manufacturing_materials m JOIN manufacturing_orders o ON o.id = m.order_id WHERE m.lot_batch_id = ? AND m.lot_number = ? AND o.status != 'VOID'")
    .bind(lotBatchId, lotNumber)
    .first<{ t: number }>();
  return { fineMg: lot.fine_mg - (used?.t ?? 0), branchId: lot.branch_id };
}

export async function createOrder(
  db: D1Database,
  input: CreateMfgOrderInput,
  actorId: string
): Promise<{ id: string; number: string }> {
  if (input.type === "CUSTOMER" && !input.customerId)
    throw Object.assign(new Error("Customer required for customer orders"), { code: "VALIDATION" });
  if (input.customerId) {
    const c = await db
      .prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1")
      .bind(input.customerId)
      .first();
    if (!c) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  }
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const stmts: D1PreparedStatement[] = [];
  const number = await nextMO(db, stmts);
  const id = crypto.randomUUID();
  const now = Date.now();
  stmts.push(
    db
      .prepare("INSERT INTO manufacturing_orders (id, number, type, customer_id, branch_id, design, description, due_at, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)")
      .bind(id, number, input.type, input.customerId ?? null, input.branchId, input.design, input.description ?? null, input.dueAt ?? null, now, actorId),
    buildAuditStmt(db, {
      userId: actorId, action: "mfg.create", entity: "manufacturing_order", entityId: id,
      next: { number, type: input.type }, branchId: input.branchId,
    })
  );
  await db.batch(stmts);
  return { id, number };
}

export async function addMaterials(
  db: D1Database,
  orderId: string,
  lots: { lotBatchId: string; lotNumber: string; fineMg: number }[],
  actorId: string
): Promise<{ allocatedFineMg: number }> {
  const order = await loadOrder(db, orderId);
  if (order.status !== "DRAFT")
    throw Object.assign(new Error("Materials can only be added to draft orders"), { code: "CONFLICT" });
  const stmts: D1PreparedStatement[] = [];
  for (const lot of lots) {
    if (lot.fineMg <= 0)
      throw Object.assign(new Error("Allocation must be positive"), { code: "VALIDATION" });
    const rem = await lotRemaining(db, lot.lotBatchId, lot.lotNumber);
    if (rem.branchId !== order.branch_id)
      throw Object.assign(new Error(`Lot not in order branch: ${lot.lotNumber}`), { code: "VALIDATION" });
    if (lot.fineMg > rem.fineMg)
      throw Object.assign(new Error(`Lot short: ${rem.fineMg}mg available for ${lot.lotNumber}`), { code: "CONFLICT" });
    stmts.push(
      db
        .prepare("INSERT INTO manufacturing_materials (id, order_id, lot_batch_id, lot_number, fine_mg) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), orderId, lot.lotBatchId, lot.lotNumber, lot.fineMg)
    );
  }
  const total = await allocatedFine(db, orderId);
  const added = lots.reduce((s, l) => s + l.fineMg, 0);
  stmts.push(
    db.prepare("UPDATE manufacturing_orders SET status = 'ALLOCATED' WHERE id = ?").bind(orderId),
    buildAuditStmt(db, {
      userId: actorId, action: "mfg.materials", entity: "manufacturing_order", entityId: orderId,
      next: { added: lots.length, allocatedFineMg: total + added }, branchId: order.branch_id,
    })
  );
  await db.batch(stmts);
  return { allocatedFineMg: total + added };
}

export async function produce(
  db: D1Database,
  orderId: string,
  input: ProduceMfgInput,
  actorId: string
): Promise<{ outputFineMg: number; lossPct: number }> {
  const order = await loadOrder(db, orderId);
  if (order.status !== "ALLOCATED" && order.status !== "QC_FAILED")
    throw Object.assign(new Error("Produce needs an allocated order"), { code: "CONFLICT" });
  const allocated = await allocatedFine(db, orderId);
  if (allocated <= 0)
    throw Object.assign(new Error("No materials allocated"), { code: "VALIDATION" });

  let outputFineMg = 0;
  const specs: { grossMg: number; stoneMg: number; netMg: number; fineMg: number; row: ProduceMfgInput["outputs"][number] }[] = [];
  for (const o of input.outputs) {
    const cat = await db.prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1").bind(o.categoryId).first();
    if (!cat) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
    const metal = await db.prepare("SELECT id FROM metal_types WHERE id = ? AND is_active = 1").bind(o.metalTypeId).first();
    if (!metal) throw Object.assign(new Error("Metal type not found"), { code: "NOT_FOUND" });
    const pur = await db.prepare("SELECT permille FROM purities WHERE id = ? AND is_active = 1").bind(o.purityId).first<{ permille: number }>();
    if (!pur) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
    const grossMg = gToMg(o.grossG);
    const stoneMg = gToMg(o.stoneG);
    const netMg = grossMg - stoneMg;
    if (netMg <= 0) throw Object.assign(new Error("Stone weight must be less than gross weight"), { code: "VALIDATION" });
    const fineMg = fineGoldMg(netMg, pur.permille);
    outputFineMg += fineMg;
    specs.push({ grossMg, stoneMg, netMg, fineMg, row: o });
  }
  if (outputFineMg + input.lossMg !== allocated)
    throw Object.assign(
      new Error(`Out of balance: allocated ${allocated}mg vs outputs ${outputFineMg}mg + loss ${input.lossMg}mg`),
      { code: "VALIDATION" }
    );
  if (input.lossMg > 0 && !input.lossReason)
    throw Object.assign(new Error("Loss reason required"), { code: "VALIDATION" });
  const pct = allocated > 0 ? (input.lossMg / allocated) * 100 : 0;
  if (pct > 0) {
    const s = await getSetting(db, "mfg_loss_approve_pct");
    const threshold = typeof s?.value === "number" ? s.value : 3;
    if (pct > threshold) {
      if (!input.approvedBy)
        throw Object.assign(new Error(`Loss exceeds ${threshold}% approval threshold`), { code: "FORBIDDEN" });
      await requireMfgApprover(db, input.approvedBy, actorId);
    }
  }
  const stmts: D1PreparedStatement[] = [];
  for (const s of specs) {
    stmts.push(
      db
        .prepare("INSERT INTO manufacturing_outputs (id, order_id, category_id, metal_type_id, purity_id, name, gross_mg, stone_mg, net_mg, making_cents, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), orderId, s.row.categoryId, s.row.metalTypeId, s.row.purityId, s.row.name, s.grossMg, s.stoneMg, s.netMg, lkrToCents(s.row.makingLkr), s.row.location ?? null)
    );
  }
  stmts.push(
    db
      .prepare("UPDATE manufacturing_orders SET labour_cents = ?, making_cents = ?, stone_cost_cents = ?, loss_mg = ?, loss_reason = ?, status = 'IN_PRODUCTION' WHERE id = ?")
      .bind(lkrToCents(input.labourLkr), lkrToCents(input.makingLkr), lkrToCents(input.stoneCostLkr), input.lossMg, input.lossReason ?? null, orderId),
    buildAuditStmt(db, {
      userId: actorId, action: "mfg.produce", entity: "manufacturing_order", entityId: orderId,
      next: { outputs: specs.length, outputFineMg, lossMg: input.lossMg }, reason: input.lossReason, branchId: order.branch_id,
    })
  );
  await db.batch(stmts);
  return { outputFineMg, lossPct: pct };
}

export async function qcCheck(
  db: D1Database,
  orderId: string,
  pass: boolean,
  reason: string | undefined,
  actorId: string
): Promise<void> {
  const order = await loadOrder(db, orderId);
  if (order.status !== "IN_PRODUCTION")
    throw Object.assign(new Error("QC needs an in-production order"), { code: "CONFLICT" });
  if (!pass && !reason)
    throw Object.assign(new Error("Fail reason required"), { code: "VALIDATION" });
  await db.batch([
    db.prepare("UPDATE manufacturing_orders SET status = ? WHERE id = ?").bind(pass ? "QC_PASSED" : "QC_FAILED", orderId),
    buildAuditStmt(db, {
      userId: actorId, action: "mfg.qc", entity: "manufacturing_order", entityId: orderId,
      prev: { status: "IN_PRODUCTION" }, next: { status: pass ? "QC_PASSED" : "QC_FAILED" },
      reason, branchId: order.branch_id,
    }),
  ]);
}

export async function finishOrder(
  db: D1Database,
  orderId: string,
  actorId: string
): Promise<{ productIds: string[]; barcodes: string[] }> {
  const order = await loadOrder(db, orderId);
  if (order.status !== "QC_PASSED")
    throw Object.assign(new Error("Only QC-passed orders can finish"), { code: "CONFLICT" });
  const { results: outputs } = await db
    .prepare("SELECT * FROM manufacturing_outputs WHERE order_id = ?")
    .bind(orderId)
    .all<{
      id: string; category_id: string; metal_type_id: string; purity_id: string; name: string;
      gross_mg: number; stone_mg: number; net_mg: number; making_cents: number; location: string | null;
    }>();
  if (!outputs || outputs.length === 0)
    throw Object.assign(new Error("Order has no outputs"), { code: "VALIDATION" });
  const { results: mats } = await db
    .prepare("SELECT lot_batch_id, lot_number, fine_mg FROM manufacturing_materials WHERE order_id = ?")
    .bind(orderId)
    .all<{ lot_batch_id: string; lot_number: string; fine_mg: number }>();
  const rates = await currentGoldRatesCents(db);
  const byPurity = new Map(rates.map((r) => [r.purity_id, r.rate_cents_per_g]));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const productIds: string[] = [];
  const barcodes: string[] = [];

  const goldValues = new Map<string, number>();
  for (const o of outputs) {
    const rate = byPurity.get(o.purity_id);
    if (rate === undefined)
      throw Object.assign(new Error("No board rate for output purity"), { code: "VALIDATION" });
    const out = await db
      .prepare("SELECT permille FROM purities WHERE id = ?")
      .bind(o.purity_id)
      .first<{ permille: number }>();
    if (!out) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
    goldValues.set(o.id, Math.round((fineGoldMg(o.net_mg, out.permille) * rate) / 1000));
  }
  const extras = order.labour_cents + order.making_cents + order.stone_cost_cents;
  const weights = outputs.map((o) => o.net_mg);
  const totalFine = weights.reduce((s, v) => s + v, 0);
  const shares = weights.map((f) => Math.floor((extras * f) / Math.max(totalFine, 1)));

  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i]!;
    const share = shares[i]! + (i === 0 ? extras - shares.reduce((s, x) => s + x, 0) : 0);
    const costCents = (goldValues.get(o.id) ?? 0) + share;
    const built = await buildCreateProductStmts(
      db,
      {
        name: o.name,
        categoryId: o.category_id,
        metalTypeId: o.metal_type_id,
        purityId: o.purity_id,
        grossG: o.gross_mg / 1000,
        stoneG: o.stone_mg / 1000,
        makingLkr: 0,
        wastageG: 0,
        costLkr: costCents / 100,
        location: o.location ?? undefined,
        notes: `Manufactured by ${order.number}`,
        branchId: order.branch_id,
      },
      actorId,
      order.branch_id,
      now
    );
    stmts.push(...built.stmts);
    stmts.push(
      db.prepare("UPDATE manufacturing_outputs SET product_id = ?, cost_cents = ? WHERE id = ?").bind(built.id, costCents, o.id)
    );
    productIds.push(built.id);
    barcodes.push(built.barcode);
  }
  for (const m of mats ?? []) {
    const lot = await db
      .prepare("SELECT weight_mg, permille FROM melting_outputs WHERE batch_id = ? AND lot_number = ?")
      .bind(m.lot_batch_id, m.lot_number)
      .first<{ weight_mg: number; permille: number }>();
    if (!lot) throw Object.assign(new Error(`Lot not found: ${m.lot_number}`), { code: "NOT_FOUND" });
    stmts.push(
      db
        .prepare("INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'MANUFACTURING_INPUT', ?, ?, ?, 'manufacturing_order', ?, NULL, NULL, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), now, order.branch_id, `melting-lot:${m.lot_number}`, `manufacturing:${orderId}`, lot.weight_mg, lot.permille, m.fine_mg, orderId, actorId, null, now, actorId)
    );
  }
  for (const pid of productIds) {
    const p = await db
      .prepare("SELECT p.net_mg, p.fine_gold_mg, pu.permille FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id = ?")
      .bind(pid)
      .first<{ net_mg: number; fine_gold_mg: number; permille: number }>();
    if (!p) throw new Error("Finished product missing");
    stmts.push(
      db
        .prepare("INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'MANUFACTURING_OUTPUT', ?, ?, ?, 'manufacturing_order', ?, ?, NULL, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), now, order.branch_id, `manufacturing:${orderId}`, `branch:${order.branch_id}`, p.net_mg, p.permille, p.fine_gold_mg, orderId, pid, actorId, null, now, actorId)
    );
  }
  if (order.loss_mg > 0) {
    const firstPur = await db
      .prepare("SELECT pu.permille FROM manufacturing_outputs mo JOIN purities pu ON pu.id = mo.purity_id WHERE mo.order_id = ? LIMIT 1")
      .bind(orderId)
      .first<{ permille: number }>();
    stmts.push(
      db
        .prepare(        "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, 'loss', 'LOSS', ?, ?, ?, 'manufacturing_order', ?, NULL, NULL, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), now, order.branch_id, `manufacturing:${orderId}`, order.loss_mg, firstPur?.permille ?? 0, order.loss_mg, orderId, actorId, null, now, actorId)
    );
  }
  stmts.push(
    db.prepare("UPDATE manufacturing_orders SET status = 'COMPLETE' WHERE id = ?").bind(orderId),
    buildAuditStmt(db, {
      userId: actorId, action: "mfg.finish", entity: "manufacturing_order", entityId: orderId,
      prev: { status: "QC_PASSED" }, next: { status: "COMPLETE", products: productIds.length },
      branchId: order.branch_id,
    })
  );
  await db.batch(stmts);
  return { productIds, barcodes };
}

export async function voidOrder(db: D1Database, orderId: string, reason: string, actorId: string): Promise<void> {
  const order = await loadOrder(db, orderId);
  if (order.status !== "DRAFT" && order.status !== "ALLOCATED")
    throw Object.assign(new Error("Only draft/allocated orders can be voided"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("DELETE FROM manufacturing_materials WHERE order_id = ?").bind(orderId),
    db.prepare("DELETE FROM manufacturing_outputs WHERE order_id = ?").bind(orderId),
    db.prepare("UPDATE manufacturing_orders SET status = 'VOID' WHERE id = ?").bind(orderId),
    buildAuditStmt(db, {
      userId: actorId, action: "mfg.void", entity: "manufacturing_order", entityId: orderId,
      prev: { status: order.status }, next: { status: "VOID" }, reason, branchId: order.branch_id,
    }),
  ]);
}

export async function getOrder(db: D1Database, id: string) {
  const order = await loadOrder(db, id);
  const customer = order.customer_id
    ? await db.prepare("SELECT id, name, code FROM customers WHERE id = ?").bind(order.customer_id).first()
    : null;
  const { results: materials } = await db
    .prepare("SELECT * FROM manufacturing_materials WHERE order_id = ?")
    .bind(id)
    .all();
  const { results: outputs } = await db
    .prepare("SELECT mo.*, p.barcode, p.sku, p.status AS product_status FROM manufacturing_outputs mo LEFT JOIN products p ON p.id = mo.product_id WHERE mo.order_id = ?")
    .bind(id)
    .all();
  const { results: ledger } = await db
    .prepare("SELECT * FROM gold_ledger WHERE ref_entity = 'manufacturing_order' AND ref_id = ? ORDER BY occurred_at")
    .bind(id)
    .all();
  return { order, customer, materials: materials ?? [], outputs: outputs ?? [], ledger: ledger ?? [] };
}

export async function listOrders(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: PageOpts & { status?: string; type?: string; branchId?: string; customerId?: string }
) {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(o.number LIKE ? OR o.design LIKE ?)"];
  const vals: unknown[] = [like, like];
  if (opts.status) {
    conds.push("o.status = ?");
    vals.push(opts.status);
  }
  if (opts.type) {
    conds.push("o.type = ?");
    vals.push(opts.type);
  }
  if (opts.customerId) {
    conds.push("o.customer_id = ?");
    vals.push(opts.customerId);
  }
  if (opts.branchId) {
    conds.push("o.branch_id = ?");
    vals.push(opts.branchId);
  } else if (!canManageAll) {
    conds.push("o.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)");
    vals.push(userId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM manufacturing_orders o ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT o.*, c.name AS customer_name FROM manufacturing_orders o LEFT JOIN customers c ON c.id = o.customer_id ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function mfgSummary(db: D1Database, opts: { from: number; to: number; branchId?: string }) {
  const conds = ["o.created_at >= ?", "o.created_at <= ?"];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.branchId) {
    conds.push("o.branch_id = ?");
    vals.push(opts.branchId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const { results: byStatus } = await db
    .prepare(`SELECT o.status AS status, COUNT(*) AS n FROM manufacturing_orders o ${where} GROUP BY o.status`)
    .bind(...vals)
    .all<{ status: string; n: number }>();
  const { results: goldRows } = await db
    .prepare(
      `SELECT COALESCE(SUM(m.fine_mg), 0) AS goldIn, COALESCE(SUM(o2.loss_mg), 0) AS lossMg, COALESCE(SUM(o2.labour_cents + o2.making_cents + o2.stone_cost_cents), 0) AS labourCents FROM manufacturing_orders o2 LEFT JOIN manufacturing_materials m ON m.order_id = o2.id ${where.replaceAll("o.", "o2.")}`
    )
    .bind(...vals)
    .all<{ goldIn: number; lossMg: number; labourCents: number }>();
  const { results: outRows } = await db
    .prepare(
      `SELECT COALESCE(SUM(p.fine_gold_mg), 0) AS goldOut FROM manufacturing_outputs mo JOIN products p ON p.id = mo.product_id JOIN manufacturing_orders o ON o.id = mo.order_id ${where}`
    )
    .bind(...vals)
    .all<{ goldOut: number }>();
  const g = goldRows?.[0];
  return {
    byStatus: byStatus ?? [],
    goldInMg: g?.goldIn ?? 0,
    goldOutMg: outRows?.[0]?.goldOut ?? 0,
    lossMg: g?.lossMg ?? 0,
    labourCents: g?.labourCents ?? 0,
  };
}

export async function wipList(db: D1Database, branchId?: string) {
  const cond = branchId ? "AND o.branch_id = ?" : "";
  const vals = branchId ? [branchId] : [];
  const { results } = await db
    .prepare(
      `SELECT o.id, o.number, o.status, o.branch_id, COALESCE(SUM(m.fine_mg), 0) AS allocatedMg, COUNT(DISTINCT mo.id) AS outputs FROM manufacturing_orders o LEFT JOIN manufacturing_materials m ON m.order_id = o.id LEFT JOIN manufacturing_outputs mo ON mo.order_id = o.id WHERE o.status IN ('ALLOCATED', 'IN_PRODUCTION', 'QC_PASSED', 'QC_FAILED') ${cond} GROUP BY o.id ORDER BY o.created_at DESC`
    )
    .bind(...vals)
    .all();
  return results ?? [];
}
