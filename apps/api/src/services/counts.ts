import { compareCount } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { postGoldStmts } from "./gold";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
import { currentGoldRatesCents } from "./rates";

export type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";

export async function assertCountLock(db: D1Database, productId: string): Promise<void> {
  const prod = await db.prepare("SELECT id, branch_id FROM products WHERE id = ?").bind(productId).first<{ id: string; branch_id: string }>();
  if (!prod) return;
  const { results } = await db.prepare(`SELECT id, expected_json AS json FROM stock_counts WHERE branch_id = ? AND status = 'OPEN'`).bind(prod.branch_id).all<{ id: string; json: string }>();
  for (const row of results ?? []) {
    const expected = JSON.parse(row.json) as { productId: string }[];
    if (expected.some((e) => e.productId === productId))
      throw Object.assign(new Error("Product is under an open stock count"), { code: "TRANSITION_LOCKED" });
  }
}

export async function startCount(db: D1Database, input: { branchId: string; scope: CountScope; scopeRef?: string }, actorId: string): Promise<{ id: string; expectedCount: number }> {
  if (!["FULL", "CATEGORY", "BRANCH", "LOCATION"].includes(input.scope))
    throw Object.assign(new Error("Invalid scope"), { code: "VALIDATION" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  let cond = "p.status = 'IN_STOCK' AND p.branch_id = ?";
  const vals: unknown[] = [input.branchId];
  if (input.scope === "CATEGORY") {
    const cat = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(input.scopeRef).first();
    if (!cat) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
    cond += " AND p.category_id = ?";
    vals.push(input.scopeRef);
  }
  if (input.scope === "LOCATION") {
    if (!input.scopeRef) throw Object.assign(new Error("location required"), { code: "VALIDATION" });
    cond += " AND p.location = ?";
    vals.push(input.scopeRef);
  }
  const { results } = await db.prepare(`SELECT p.id, p.barcode FROM products p WHERE ${cond}`).bind(...vals).all<{ id: string; barcode: string }>();
  const expected = (results ?? []).map((r) => ({ productId: r.id, barcode: r.barcode }));
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(`INSERT INTO stock_counts (id, branch_id, scope, scope_ref, status, expected_json, opened_by, created_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`).bind(id, input.branchId, input.scope, input.scopeRef ?? null, JSON.stringify(expected), actorId, now),
      buildAuditStmt(db, { userId: actorId, action: "count.start", entity: "stock_count", entityId: id, next: { scope: input.scope }, branchId: input.branchId }),
    ]);
  } catch (e) {
    throw Object.assign(new Error("An open count already exists for this scope"), { code: "CONFLICT" });
  }
  return { id, expectedCount: expected.length };
}

export async function recordScan(db: D1Database, countId: string, barcode: string, actorId: string): Promise<{ flag: string }> {
  const count = await db.prepare("SELECT id, status FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; status: string }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  if (count.status !== "OPEN") throw Object.assign(new Error("Count is closed"), { code: "CONFLICT" });
  const prod = await db.prepare("SELECT id FROM products WHERE UPPER(barcode) = UPPER(?)").bind(barcode).first<{ id: string }>();
  const prior = await db.prepare("SELECT id FROM count_scans WHERE count_id = ? AND UPPER(barcode) = UPPER(?)").bind(countId, barcode).first();
  const flag = prod ? (prior ? "DUPLICATE" : "OK") : "UNEXPECTED";
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO count_scans (id, count_id, barcode, product_id, flag, scanned_by, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), countId, barcode.toUpperCase(), prod?.id ?? null, flag, actorId, now, now),
    buildAuditStmt(db, { userId: actorId, action: "count.scan", entity: "stock_count", entityId: countId, next: { barcode: barcode.toUpperCase(), flag } }),
  ]);
  return { flag };
}

export async function compare(db: D1Database, countId: string) {
  const count = await db.prepare("SELECT expected_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ json: string }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  const { results } = await db.prepare("SELECT barcode, product_id FROM count_scans WHERE count_id = ?").bind(countId).all<{ barcode: string; product_id: string | null }>();
  return compareCount(JSON.parse(count.json), (results ?? []).map((r) => ({ barcode: r.barcode, productId: r.product_id })));
}

export async function addNote(db: D1Database, countId: string, productId: string, note: string, actorId: string): Promise<void> {
  const count = await db.prepare("SELECT id, status, result_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; status: string; json: string | null }>();
  if (!count || count.status !== "OPEN") throw Object.assign(new Error("Count not open"), { code: "CONFLICT" });
  const notes = count.json ? (JSON.parse(count.json).notes ?? {}) : {};
  notes[productId] = note;
  await db.batch([
    db.prepare("UPDATE stock_counts SET result_json = ? WHERE id = ?").bind(JSON.stringify({ notes }), countId),
    buildAuditStmt(db, { userId: actorId, action: "count.note", entity: "stock_count", entityId: countId, next: { productId }, reason: note }),
  ]);
}

export async function cancelCount(db: D1Database, countId: string, reason: string, actorId: string): Promise<void> {
  const cmp = await compare(db, countId);
  await db.batch([
    db.prepare("UPDATE stock_counts SET status = 'CANCELLED', result_json = ?, closed_by = ? WHERE id = ? AND status = 'OPEN'").bind(JSON.stringify(cmp), actorId, countId),
    buildAuditStmt(db, { userId: actorId, action: "count.cancel", entity: "stock_count", entityId: countId, reason }),
  ]);
}

export async function approveCount(db: D1Database, countId: string, input: { reason: string; approvedBy: string }, actorId: string): Promise<{ posted: number }> {
  if (!input.reason?.trim()) throw Object.assign(new Error("Reason required"), { code: "VALIDATION" });
  if (input.approvedBy === actorId) throw Object.assign(new Error("Approver cannot be yourself"), { code: "FORBIDDEN" });
  const approver = await db.prepare(
    `SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`
  ).bind(input.approvedBy).all<{ name: string }>();
  if (!(approver.results ?? []).some((r) => r.name === "gold:manage"))
    throw Object.assign(new Error("Approval requires gold:manage"), { code: "FORBIDDEN" });
  const count = await db.prepare("SELECT id, branch_id, status FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; branch_id: string; status: string }>();
  if (!count || count.status !== "OPEN") throw Object.assign(new Error("Count not open"), { code: "CONFLICT" });
  const cmp = await compare(db, countId);
  const rates = await currentGoldRatesCents(db);
  const now = Date.now();
  const entryDate = await businessDateFor(db, now);
  let posted = 0;
  for (const productId of cmp.missing) {
    const prod = await db.prepare("SELECT id, status, branch_id, net_mg, fine_gold_mg, cost_cents, purity_id FROM products WHERE id = ?").bind(productId).first<{ id: string; status: string; branch_id: string; net_mg: number; fine_gold_mg: number; cost_cents: number | null; purity_id: string }>();
    if (!prod || prod.status !== "IN_STOCK") continue;
    if (!prod.cost_cents || prod.cost_cents <= 0) throw Object.assign(new Error(`No book cost for ${productId}; cannot post adjustment`), { code: "VALIDATION" });
    if (!rates.some((r) => r.purity_id === prod.purity_id))
      throw Object.assign(new Error("No gold rate for this purity; cannot value the adjustment"), { code: "VALIDATION" });
    const purity = await db.prepare("SELECT permille FROM purities WHERE id = ?").bind(prod.purity_id).first<{ permille: number }>();
    if (!purity) throw Object.assign(new Error("Purity not found"), { code: "VALIDATION" });
    const moveId = crypto.randomUUID();
    const goldStmts = await postGoldStmts(db, [{ branchId: count.branch_id, source: `branch:${count.branch_id}`, destination: "loss", type: "ADJUSTMENT", weightMg: prod.net_mg, permille: purity.permille, refEntity: "stock_count", refId: countId, productId, notes: input.reason }], { actorId, auditAction: "count.adjust", auditEntity: "stock_count", auditEntityId: countId, branchId: count.branch_id });
    const entry = await buildEntryStmts(db, { lines: [{ account: "5300", debitCents: prod.cost_cents, creditCents: 0 }, { account: "1100", debitCents: 0, creditCents: prod.cost_cents }], refEntity: "stock_count", refId: countId, memo: `Stock count shortage: ${input.reason}`, branchId: count.branch_id, actorId, auditAction: "count.adjust.value", auditEntity: "stock_count", auditEntityId: countId, sourceModule: "gold" }, { entryDate });
    await db.batch([
      db.prepare("UPDATE products SET status = 'LOST' WHERE id = ? AND status = 'IN_STOCK'").bind(productId),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'LOSS', 'IN_STOCK', 'LOST', ?, ?, ?, ?, ?, ?)").bind(moveId, productId, prod.branch_id, prod.branch_id, prod.net_mg, input.reason, now, actorId),
      ...goldStmts,
      ...entry.stmts,
    ]);
    posted += 1;
  }
  await db.batch([
    db.prepare("UPDATE stock_counts SET status = 'COMPLETE', result_json = ?, closed_by = ? WHERE id = ?").bind(JSON.stringify({ ...cmp, posted }), actorId, countId),
    buildAuditStmt(db, { userId: actorId, action: "count.approve", entity: "stock_count", entityId: countId, reason: input.reason }),
  ]);
  return { posted };
}
