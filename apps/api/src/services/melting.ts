import { fineGoldMg, gToMg } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { postGoldStmts } from "./gold";
import { getSetting } from "./settings";

async function nextMelt(db: D1Database, stmts: D1PreparedStatement[]): Promise<string> {
  const row = await db
    .prepare("SELECT next FROM counters WHERE name = 'MELT'")
    .bind()
    .first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'MELT'").bind(row.next + 1));
  return `MELT-${String(row.next).padStart(6, "0")}`;
}

async function requireGoldApprover(db: D1Database, approverId: string, actorId: string): Promise<void> {
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
  if (!(results ?? []).some((r) => r.name === "gold:manage"))
    throw Object.assign(new Error("Approval requires gold:manage"), { code: "FORBIDDEN" });
}

type BatchRow = {
  id: string;
  number: string;
  branch_id: string;
  status: string;
  input_fine_mg: number;
  output_fine_mg: number;
  waste_mg: number;
  loss_mg: number;
  recovery_mg: number;
};

async function loadBatch(db: D1Database, id: string): Promise<BatchRow> {
  const row = await db.prepare("SELECT * FROM melting_batches WHERE id = ?").bind(id).first<BatchRow>();
  if (!row) throw Object.assign(new Error("Batch not found"), { code: "NOT_FOUND" });
  return row;
}

export async function createBatch(
  db: D1Database,
  branchId: string,
  notes: string | undefined,
  actorId: string
): Promise<{ id: string; number: string }> {
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const stmts: D1PreparedStatement[] = [];
  const number = await nextMelt(db, stmts);
  const id = crypto.randomUUID();
  const now = Date.now();
  stmts.push(
    db
      .prepare("INSERT INTO melting_batches (id, number, branch_id, status, notes, created_at, created_by) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?)")
      .bind(id, number, branchId, notes ?? null, now, actorId),
    buildAuditStmt(db, {
      userId: actorId, action: "melt.create", entity: "melting_batch", entityId: id,
      next: { number }, branchId,
    })
  );
  await db.batch(stmts);
  return { id, number };
}

export async function addItems(
  db: D1Database,
  batchId: string,
  oldGoldIds: string[],
  actorId: string
): Promise<{ added: number; inputFineMg: number }> {
  const batch = await loadBatch(db, batchId);
  if (batch.status !== "DRAFT")
    throw Object.assign(new Error("Items can only be added to draft batches"), { code: "CONFLICT" });
  const stmts: D1PreparedStatement[] = [];
  let added = 0;
  for (const itemId of oldGoldIds) {
    const item = await db
      .prepare("SELECT id, status, branch_id, gross_mg, net_mg, fine_mg FROM old_gold_items WHERE id = ?")
      .bind(itemId)
      .first<{ id: string; status: string; branch_id: string; gross_mg: number; net_mg: number; fine_mg: number }>();
    if (!item) throw Object.assign(new Error(`Item not found: ${itemId}`), { code: "NOT_FOUND" });
    if (item.status !== "AVAILABLE")
      throw Object.assign(new Error(`Only AVAILABLE items can melt: ${itemId}`), { code: "VALIDATION" });
    if (item.branch_id !== batch.branch_id)
      throw Object.assign(new Error(`Item not in batch branch: ${itemId}`), { code: "VALIDATION" });
    const taken = await db
      .prepare("SELECT batch_id FROM melting_inputs WHERE old_gold_id = ?")
      .bind(itemId)
      .first();
    if (taken) throw Object.assign(new Error(`Item already in a batch: ${itemId}`), { code: "CONFLICT" });
    stmts.push(
      db
        .prepare("INSERT INTO melting_inputs (id, batch_id, old_gold_id, gross_mg, net_mg, fine_mg) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), batchId, itemId, item.gross_mg, item.net_mg, item.fine_mg),
      db.prepare("UPDATE old_gold_items SET status = 'RESERVED_FOR_MELTING' WHERE id = ?").bind(itemId)
    );
    added++;
  }
  const { results } = await db
    .prepare("SELECT COALESCE(SUM(fine_mg), 0) AS total FROM melting_inputs WHERE batch_id = ?")
    .bind(batchId)
    .all<{ total: number }>();
  const existing = results?.[0]?.total ?? 0;
  const { results: addedRows } = await db
    .prepare(`SELECT fine_mg FROM old_gold_items WHERE id IN (${oldGoldIds.map(() => "?").join(",")})`)
    .bind(...oldGoldIds)
    .all<{ fine_mg: number }>();
  const inputFineMg = existing + (addedRows ?? []).reduce((s, r) => s + r.fine_mg, 0);
  stmts.push(
    db.prepare("UPDATE melting_batches SET input_fine_mg = ? WHERE id = ?").bind(inputFineMg, batchId),
    buildAuditStmt(db, {
      userId: actorId, action: "melt.add", entity: "melting_batch", entityId: batchId,
      next: { added, inputFineMg }, branchId: batch.branch_id,
    })
  );
  await db.batch(stmts);
  return { added, inputFineMg };
}

export async function lockBatch(db: D1Database, batchId: string, actorId: string): Promise<void> {
  const batch = await loadBatch(db, batchId);
  if (batch.status !== "DRAFT")
    throw Object.assign(new Error("Only draft batches can be locked"), { code: "CONFLICT" });
  if (batch.input_fine_mg <= 0)
    throw Object.assign(new Error("Cannot lock an empty batch"), { code: "VALIDATION" });
  await db.batch([
    db.prepare("UPDATE melting_batches SET status = 'LOCKED' WHERE id = ?").bind(batchId),
    buildAuditStmt(db, {
      userId: actorId, action: "melt.lock", entity: "melting_batch", entityId: batchId,
      prev: { status: "DRAFT" }, next: { status: "LOCKED" }, branchId: batch.branch_id,
    }),
  ]);
}

export async function recordMelt(
  db: D1Database,
  batchId: string,
  input: { outputWeightG: number; assayPermille: number; wasteG: number; outputType: "grain" | "bar" },
  actorId: string
): Promise<{ outputFineMg: number; lossMg: number; recoveryMg: number; lossPct: number }> {
  const batch = await loadBatch(db, batchId);
  if (batch.status !== "LOCKED")
    throw Object.assign(new Error("Only locked batches can be melted"), { code: "CONFLICT" });
  const outputMg = gToMg(input.outputWeightG);
  const wasteMg = gToMg(input.wasteG);
  const outputFineMg = fineGoldMg(outputMg, input.assayPermille);
  const diff = batch.input_fine_mg - outputFineMg - wasteMg;
  const lossMg = diff >= 0 ? diff : 0;
  const recoveryMg = diff >= 0 ? 0 : -diff;
  const lotNumber = `MLT-${batch.number.slice(5)}-01`;
  await db.batch([
    db
      .prepare("INSERT INTO melting_outputs (id, batch_id, lot_number, weight_mg, permille, fine_mg, output_type) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), batchId, lotNumber, outputMg, input.assayPermille, outputFineMg, input.outputType),
    db
      .prepare("UPDATE melting_batches SET output_fine_mg = ?, waste_mg = ?, loss_mg = ?, recovery_mg = ?, status = 'MELTED' WHERE id = ?")
      .bind(outputFineMg, wasteMg, lossMg, recoveryMg, batchId),
    buildAuditStmt(db, {
      userId: actorId, action: "melt.record", entity: "melting_batch", entityId: batchId,
      next: { outputFineMg, lossMg, recoveryMg, lotNumber }, branchId: batch.branch_id,
    }),
  ]);
  return {
    outputFineMg,
    lossMg,
    recoveryMg,
    lossPct: batch.input_fine_mg > 0 ? (lossMg / batch.input_fine_mg) * 100 : 0,
  };
}

export async function approveBatch(
  db: D1Database,
  batchId: string,
  input: { reason: string; approvedBy?: string },
  actorId: string
): Promise<{ lossMg: number; recoveryMg: number }> {
  const batch = await loadBatch(db, batchId);
  if (batch.status !== "MELTED")
    throw Object.assign(new Error("Only melted batches can be approved"), { code: "CONFLICT" });
  const s = await getSetting(db, "melt_loss_approve_pct");
  const threshold = typeof s?.value === "number" ? s.value : 2;
  const pct = batch.input_fine_mg > 0 ? (batch.loss_mg / batch.input_fine_mg) * 100 : 0;
  if (pct > threshold) {
    if (!input.approvedBy)
      throw Object.assign(new Error(`Loss exceeds ${threshold}% approval threshold`), { code: "FORBIDDEN" });
    await requireGoldApprover(db, input.approvedBy, actorId);
  }
  const { results: inputs } = await db
    .prepare("SELECT old_gold_id, net_mg, fine_mg FROM melting_inputs WHERE batch_id = ?")
    .bind(batchId)
    .all<{ old_gold_id: string; net_mg: number; fine_mg: number }>();
  const outputs = await db
    .prepare("SELECT weight_mg, permille, fine_mg FROM melting_outputs WHERE batch_id = ?")
    .bind(batchId)
    .first<{ weight_mg: number; permille: number; fine_mg: number }>();
  if (!outputs) throw Object.assign(new Error("Batch has no output"), { code: "VALIDATION" });

  const stmts: D1PreparedStatement[] = [];
  for (const i of inputs ?? []) {
    const tested = await db
      .prepare("SELECT tested_permille FROM old_gold_items WHERE id = ?")
      .bind(i.old_gold_id)
      .first<{ tested_permille: number | null }>();
    stmts.push(
      db
        .prepare("INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'MELTING_INPUT', ?, ?, ?, 'melting_batch', ?, NULL, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), Date.now(), batch.branch_id, `old-gold:${i.old_gold_id}`, `melting:${batchId}`, i.net_mg, tested?.tested_permille ?? 0, i.fine_mg, batchId, i.old_gold_id, actorId, input.reason, Date.now(), actorId)
    );
    stmts.push(db.prepare("UPDATE old_gold_items SET status = 'MELTED' WHERE id = ?").bind(i.old_gold_id));
  }
  stmts.push(
    db
      .prepare("INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'MELTING_OUTPUT', ?, ?, ?, 'melting_batch', ?, NULL, NULL, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), Date.now(), batch.branch_id, `melting:${batchId}`, `branch:${batch.branch_id}`, outputs.weight_mg, outputs.permille, outputs.fine_mg, batchId, actorId, input.reason, Date.now(), actorId)
  );
  if (batch.loss_mg > 0) {
    stmts.push(
      db
        .prepare("INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, 'loss', 'LOSS', ?, ?, ?, 'melting_batch', ?, NULL, NULL, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), Date.now(), batch.branch_id, `melting:${batchId}`, batch.loss_mg, outputs.permille, batch.loss_mg, batchId, actorId, input.reason, Date.now(), actorId)
    );
  }
  if (batch.recovery_mg > 0) {
    stmts.push(
      db
        .prepare("INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'RECOVERY', ?, ?, ?, 'melting_batch', ?, NULL, NULL, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), Date.now(), batch.branch_id, `melting:${batchId}`, `branch:${batch.branch_id}`, batch.recovery_mg, outputs.permille, batch.recovery_mg, batchId, actorId, input.reason, Date.now(), actorId)
    );
  }
  stmts.push(
    db
      .prepare("UPDATE melting_batches SET status = 'APPROVED', difference_reason = ?, approved_by = ? WHERE id = ?")
      .bind(input.reason, input.approvedBy ?? actorId, batchId),
    buildAuditStmt(db, {
      userId: actorId, action: "melt.approve", entity: "melting_batch", entityId: batchId,
      next: { lossMg: batch.loss_mg, recoveryMg: batch.recovery_mg }, reason: input.reason, branchId: batch.branch_id,
    })
  );
  await db.batch(stmts);
  return { lossMg: batch.loss_mg, recoveryMg: batch.recovery_mg };
}

export async function voidBatch(db: D1Database, batchId: string, reason: string, actorId: string): Promise<void> {
  const batch = await loadBatch(db, batchId);
  if (batch.status !== "DRAFT")
    throw Object.assign(new Error("Only draft batches can be voided"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE old_gold_items SET status = 'AVAILABLE' WHERE id IN (SELECT old_gold_id FROM melting_inputs WHERE batch_id = ?)").bind(batchId),
    db.prepare("UPDATE melting_batches SET status = 'VOID' WHERE id = ?").bind(batchId),
    buildAuditStmt(db, {
      userId: actorId, action: "melt.void", entity: "melting_batch", entityId: batchId,
      prev: { status: "DRAFT" }, next: { status: "VOID" }, reason, branchId: batch.branch_id,
    }),
  ]);
}

export async function getBatch(db: D1Database, id: string) {
  const batch = await loadBatch(db, id);
  const { results: inputs } = await db
    .prepare("SELECT mi.*, o.number, o.description FROM melting_inputs mi JOIN old_gold_items o ON o.id = mi.old_gold_id WHERE mi.batch_id = ?")
    .bind(id)
    .all();
  const { results: outputs } = await db
    .prepare("SELECT * FROM melting_outputs WHERE batch_id = ?")
    .bind(id)
    .all();
  const { results: ledger } = await db
    .prepare("SELECT * FROM gold_ledger WHERE ref_entity = 'melting_batch' AND ref_id = ? ORDER BY occurred_at")
    .bind(id)
    .all();
  return { batch, inputs: inputs ?? [], outputs: outputs ?? [], ledger: ledger ?? [] };
}

export async function listBatches(
  db: D1Database,
  opts: PageOpts & { status?: string; branchId?: string }
) {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(b.number LIKE ?)"];
  const vals: unknown[] = [like];
  if (opts.status) {
    conds.push("b.status = ?");
    vals.push(opts.status);
  }
  if (opts.branchId) {
    conds.push("b.branch_id = ?");
    vals.push(opts.branchId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM melting_batches b ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`SELECT * FROM melting_batches b ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}
