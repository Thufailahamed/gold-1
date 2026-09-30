import { normalizeCode } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { assertCountLock } from "./counts";
import { postGoldStmts, type GoldEntry } from "./gold";

export type TransferLineState = "PENDING" | "IN_TRANSIT" | "RECEIVED" | "RECALLED";

export type TransferDoc = {
  id: string; number: string; fromBranchId: string; toBranchId: string; status: string;
  reason: string | null; requestedBy: string | null; approvedBy: string | null;
  lines: { id: string; productId: string; barcode: string; status: TransferLineState }[];
};

export function deriveStatus(lines: { status: string }[]): string {
  if (lines.every((l) => l.status === "PENDING")) return "REQUESTED";
  if (lines.every((l) => l.status === "RECEIVED" || l.status === "RECALLED")) return "COMPLETE";
  if (lines.some((l) => l.status === "IN_TRANSIT") && lines.some((l) => l.status === "RECEIVED" || l.status === "RECALLED")) return "PARTIAL";
  return "DISPATCHED";
}

export async function loadTransfer(db: D1Database, id: string): Promise<TransferDoc> {
  const head = await db.prepare("SELECT id, number, from_branch_id, to_branch_id, status, reason, requested_by, approved_by FROM transfers WHERE id = ?").bind(id).first<{ id: string; number: string; from_branch_id: string; to_branch_id: string; status: string; reason: string | null; requested_by: string | null; approved_by: string | null }>();
  if (!head) throw Object.assign(new Error("Transfer not found"), { code: "NOT_FOUND" });
  const { results } = await db.prepare("SELECT id, product_id, barcode, status FROM transfer_lines WHERE transfer_id = ?").bind(id).all<{ id: string; product_id: string; barcode: string; status: TransferLineState }>();
  return { id: head.id, number: head.number, fromBranchId: head.from_branch_id, toBranchId: head.to_branch_id, status: head.status, reason: head.reason, requestedBy: head.requested_by, approvedBy: head.approved_by, lines: (results ?? []).map((r) => ({ id: r.id, productId: r.product_id, barcode: r.barcode, status: r.status })) };
}

export async function requestTransfer(db: D1Database, input: { fromBranchId: string; toBranchId: string; productIds: string[]; reason?: string }, actorId: string): Promise<{ id: string; number: string }> {
  if (input.fromBranchId === input.toBranchId) throw Object.assign(new Error("Branches must differ"), { code: "VALIDATION" });
  if (input.productIds.length === 0 || input.productIds.length > 100) throw Object.assign(new Error("1-100 products per transfer"), { code: "VALIDATION" });
  if (new Set(input.productIds).size !== input.productIds.length) throw Object.assign(new Error("Duplicate product in transfer"), { code: "CONFLICT" });
  for (const b of [input.fromBranchId, input.toBranchId]) {
    const br = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(b).first();
    if (!br) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  }
  const now = Date.now();
  const lines: { productId: string; barcode: string }[] = [];
  for (const pid of input.productIds) {
    const p = await db.prepare("SELECT id, barcode, status, branch_id FROM products WHERE id = ?").bind(pid).first<{ id: string; barcode: string; status: string; branch_id: string }>();
    if (!p) throw Object.assign(new Error(`Product not found: ${pid}`), { code: "NOT_FOUND" });
    if (p.status !== "IN_STOCK" || p.branch_id !== input.fromBranchId)
      throw Object.assign(new Error(`Product not available at sender: ${pid}`), { code: "VALIDATION" });
    await assertCountLock(db, pid);
    // One piece, one open document: a second request would pass validation
    // today and then fail at dispatch, stranding the first document.
    const open = await db
      .prepare("SELECT t.number FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id WHERE l.product_id = ? AND l.status IN ('PENDING','IN_TRANSIT') AND t.status IN ('REQUESTED','APPROVED','DISPATCHED','PARTIAL') LIMIT 1")
      .bind(pid)
      .first<{ number: string }>();
    if (open) throw Object.assign(new Error(`${p.barcode} is already on open transfer ${open.number}`), { code: "CONFLICT" });
    lines.push({ productId: p.id, barcode: p.barcode });
  }
  // Reserve the number atomically (see journal.ts reserveEntryNo): a
  // read-then-write split hands two concurrent requests the same number.
  const counter = await db
    .prepare("UPDATE counters SET next = next + 1 WHERE name = 'TRF' RETURNING next - 1 AS allocated")
    .bind()
    .first<{ allocated: number }>();
  if (!counter) throw Object.assign(new Error("Counter TRF missing"), { code: "INTERNAL" });
  const number = `TRF-${String(counter.allocated).padStart(6, "0")}`;
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO transfers (id, number, from_branch_id, to_branch_id, status, reason, requested_by, created_at) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?)").bind(id, number, input.fromBranchId, input.toBranchId, input.reason ?? null, actorId, now),
    ...lines.map((l) => db.prepare("INSERT INTO transfer_lines (id, transfer_id, product_id, barcode, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', ?)").bind(crypto.randomUUID(), id, l.productId, l.barcode, now)),
    buildAuditStmt(db, { userId: actorId, action: "transfer.request", entity: "transfer", entityId: id, next: { number, lines: lines.length }, branchId: input.fromBranchId }),
  ]);
  return { id, number };
}

export async function approveTransfer(db: D1Database, id: string, approverId: string, actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (doc.status !== "REQUESTED") throw Object.assign(new Error("Transfer not awaiting approval"), { code: "CONFLICT" });
  if (approverId === doc.requestedBy) throw Object.assign(new Error("Approver cannot be the requester"), { code: "FORBIDDEN" });
  const member = await db.prepare("SELECT 1 AS x FROM branch_members WHERE user_id = ? AND branch_id = ?").bind(approverId, doc.fromBranchId).first();
  if (!member) throw Object.assign(new Error("Approver must belong to the sending branch"), { code: "FORBIDDEN" });
  const perms = await db.prepare(`SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`).bind(approverId).all<{ name: string }>();
  if (!(perms.results ?? []).some((r) => r.name === "products:cancel"))
    throw Object.assign(new Error("Approval requires products:cancel"), { code: "FORBIDDEN" });
  await db.batch([
    db.prepare("UPDATE transfers SET status = 'APPROVED', approved_by = ? WHERE id = ? AND status = 'REQUESTED'").bind(approverId, id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.approve", entity: "transfer", entityId: id, next: { approvedBy: approverId } }),
  ]);
}

export async function dispatchTransfer(db: D1Database, id: string, actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (doc.status !== "APPROVED") throw Object.assign(new Error("Transfer not approved"), { code: "CONFLICT" });
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const goldEntries: GoldEntry[] = [];
  for (const line of doc.lines) {
    if (line.status !== "PENDING") throw Object.assign(new Error(`Line not pending: ${line.barcode}`), { code: "CONFLICT" });
    const p = await db.prepare("SELECT id, status, branch_id, net_mg, fine_gold_mg, purity_id FROM products WHERE id = ?").bind(line.productId).first<{ id: string; status: string; branch_id: string; net_mg: number; fine_gold_mg: number; purity_id: string }>();
    if (!p || p.status !== "IN_STOCK" || p.branch_id !== doc.fromBranchId)
      throw Object.assign(new Error(`Product not available at sender: ${line.barcode}`), { code: "CONFLICT" });
    await assertCountLock(db, line.productId);
    const purity = await db.prepare("SELECT permille FROM purities WHERE id = ?").bind(p.purity_id).first<{ permille: number }>();
    if (!purity) throw Object.assign(new Error("Purity not found"), { code: "VALIDATION" });
    stmts.push(
      db.prepare("UPDATE products SET status = 'TRANSFER_PENDING' WHERE id = ? AND status = 'IN_STOCK'").bind(line.productId),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'TRANSFER_OUT', 'IN_STOCK', 'TRANSFER_PENDING', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), line.productId, doc.fromBranchId, doc.toBranchId, p.net_mg, `Transfer ${doc.number}`, now, actorId),
      db.prepare("UPDATE transfer_lines SET status = 'IN_TRANSIT' WHERE id = ?").bind(line.id)
    );
    goldEntries.push({ branchId: doc.toBranchId, source: `branch:${doc.fromBranchId}`, destination: `branch:${doc.toBranchId}`, type: "TRANSFER", weightMg: p.net_mg, permille: purity.permille, refEntity: "transfer_line", refId: line.id, productId: line.productId, notes: `Transfer ${doc.number}` });
  }
  const goldStmts = await postGoldStmts(db, goldEntries, { actorId, auditAction: "transfer.dispatch", auditEntity: "transfer", auditEntityId: id, branchId: doc.toBranchId });
  stmts.push(...goldStmts);
  stmts.push(
    db.prepare("UPDATE transfers SET status = 'DISPATCHED' WHERE id = ? AND status = 'APPROVED'").bind(id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.dispatch", entity: "transfer", entityId: id, next: { lines: doc.lines.length } })
  );
  await db.batch(stmts);
}

export async function receiveLines(db: D1Database, id: string, barcodes: string[], actorId: string): Promise<{ received: string[]; skipped: string[] }> {
  const doc = await loadTransfer(db, id);
  if (!["DISPATCHED", "PARTIAL"].includes(doc.status)) throw Object.assign(new Error("Transfer not dispatched"), { code: "CONFLICT" });
  const byCode = new Map(doc.lines.map((l) => [normalizeCode(l.barcode), l]));
  const received: string[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const raw of barcodes) {
    const line = byCode.get(normalizeCode(raw));
    if (!line) throw Object.assign(new Error(`Unknown barcode for this transfer: ${raw}`), { code: "VALIDATION" });
    if (line.status === "RECEIVED") { skipped.push(line.barcode); continue; }
    if (line.status !== "IN_TRANSIT") throw Object.assign(new Error(`Line not in transit: ${line.barcode}`), { code: "CONFLICT" });
    const p = await db.prepare("SELECT net_mg FROM products WHERE id = ?").bind(line.productId).first<{ net_mg: number }>();
    stmts.push(
      db.prepare("UPDATE products SET status = 'IN_STOCK', branch_id = ? WHERE id = ? AND status = 'TRANSFER_PENDING'").bind(doc.toBranchId, line.productId),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'TRANSFER_IN', 'TRANSFER_PENDING', 'IN_STOCK', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), line.productId, doc.fromBranchId, doc.toBranchId, p?.net_mg ?? 0, `Transfer ${doc.number} received`, now, actorId),
      db.prepare("UPDATE transfer_lines SET status = 'RECEIVED' WHERE id = ?").bind(line.id)
    );
    line.status = "RECEIVED";
    received.push(line.barcode);
  }
  const next = deriveStatus(doc.lines);
  stmts.push(
    db.prepare("UPDATE transfers SET status = ? WHERE id = ?").bind(next, id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.receive", entity: "transfer", entityId: id, next: { received } })
  );
  await db.batch(stmts);
  return { received, skipped };
}

export async function recallLines(db: D1Database, id: string, productIds: string[], actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (!["DISPATCHED", "PARTIAL"].includes(doc.status)) throw Object.assign(new Error("Transfer not dispatched"), { code: "CONFLICT" });
  const byId = new Map(doc.lines.map((l) => [l.productId, l]));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const goldEntries: GoldEntry[] = [];
  for (const pid of productIds) {
    const line = byId.get(pid);
    if (!line || line.status !== "IN_TRANSIT") throw Object.assign(new Error(`Line not recallable: ${pid}`), { code: "CONFLICT" });
    const p = await db.prepare("SELECT p.net_mg, pu.permille FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id = ?").bind(pid).first<{ net_mg: number; permille: number }>();
    // Dispatch already moved the gold to the receiver in the ledger; a recall
    // must move it back, or the sender's shelf holds metal its ledger does not.
    if (p) goldEntries.push({ branchId: doc.fromBranchId, source: `branch:${doc.toBranchId}`, destination: `branch:${doc.fromBranchId}`, type: "TRANSFER", weightMg: p.net_mg, permille: p.permille, refEntity: "transfer_recall", refId: line.id, productId: pid, notes: `Transfer ${doc.number} recalled` });
    stmts.push(
      db.prepare("UPDATE products SET status = 'IN_STOCK' WHERE id = ? AND status = 'TRANSFER_PENDING'").bind(pid),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'TRANSFER_IN', 'TRANSFER_PENDING', 'IN_STOCK', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), pid, doc.fromBranchId, doc.fromBranchId, p?.net_mg ?? 0, `Transfer ${doc.number} recalled`, now, actorId),
      db.prepare("UPDATE transfer_lines SET status = 'RECALLED' WHERE id = ?").bind(line.id)
    );
    line.status = "RECALLED";
  }
  if (goldEntries.length)
    stmts.push(...(await postGoldStmts(db, goldEntries, { actorId, auditAction: "transfer.recall", auditEntity: "transfer", auditEntityId: id, branchId: doc.fromBranchId })));
  const next = deriveStatus(doc.lines);
  stmts.push(
    db.prepare("UPDATE transfers SET status = ? WHERE id = ?").bind(next, id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.recall", entity: "transfer", entityId: id })
  );
  await db.batch(stmts);
}

export async function cancelTransfer(db: D1Database, id: string, reason: string, actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (!["REQUESTED", "APPROVED"].includes(doc.status)) throw Object.assign(new Error("Only undispatched transfers can be cancelled; recall lines instead"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE transfers SET status = 'CANCELLED' WHERE id = ? AND status IN ('REQUESTED','APPROVED')").bind(id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.cancel", entity: "transfer", entityId: id, reason }),
  ]);
}

export async function reconcileTransfer(db: D1Database, id: string): Promise<{ passed: boolean; warnings: string[] }> {
  const doc = await loadTransfer(db, id);
  const warnings: string[] = [];
  for (const line of doc.lines) {
    const { results: moves } = await db.prepare("SELECT type, from_status, to_status FROM stock_movements WHERE product_id = ? AND reason LIKE ?").bind(line.productId, `%Transfer ${doc.number}%`).all<{ type: string; from_status: string; to_status: string }>();
    const outCount = (moves ?? []).filter((m) => m.type === "TRANSFER_OUT").length;
    const inCount = (moves ?? []).filter((m) => m.type === "TRANSFER_IN").length;
    if (outCount !== 1) warnings.push(`${line.barcode}: expected 1 TRANSFER_OUT, found ${outCount}`);
    if (line.status === "RECEIVED" && inCount !== 1) warnings.push(`${line.barcode}: RECEIVED without exactly 1 TRANSFER_IN`);
    if (line.status === "IN_TRANSIT" && inCount !== 0) warnings.push(`${line.barcode}: IN_TRANSIT with premature TRANSFER_IN`);
    const prod = await db.prepare("SELECT status, branch_id, barcode FROM products WHERE id = ?").bind(line.productId).first<{ status: string; branch_id: string; barcode: string }>();
    if (!prod) warnings.push(`${line.barcode}: product row missing`);
    else {
      if (prod.barcode !== line.barcode) warnings.push(`${line.barcode}: barcode changed on product row`);
      if (line.status === "RECEIVED" && (prod.status !== "IN_STOCK" || prod.branch_id !== doc.toBranchId)) warnings.push(`${line.barcode}: RECEIVED but not IN_STOCK at receiver`);
      if (line.status === "IN_TRANSIT" && (prod.status !== "TRANSFER_PENDING" || prod.branch_id !== doc.fromBranchId)) warnings.push(`${line.barcode}: IN_TRANSIT but not TRANSFER_PENDING at sender`);
    }
    const gold = await db.prepare("SELECT COUNT(*) AS n FROM gold_ledger WHERE ref_entity = 'transfer_line' AND ref_id = ?").bind(line.id).first<{ n: number }>();
    if (line.status !== "PENDING" && (gold?.n ?? 0) !== 1) warnings.push(`${line.barcode}: expected 1 gold TRANSFER row, found ${gold?.n ?? 0}`);
    if (line.status === "PENDING" && (gold?.n ?? 0) !== 0) warnings.push(`${line.barcode}: PENDING line with gold movement`);
    const back = await db.prepare("SELECT COUNT(*) AS n FROM gold_ledger WHERE ref_entity = 'transfer_recall' AND ref_id = ?").bind(line.id).first<{ n: number }>();
    if (line.status === "RECALLED" && (back?.n ?? 0) !== 1) warnings.push(`${line.barcode}: RECALLED without exactly 1 gold return row, found ${back?.n ?? 0}`);
    if (line.status !== "RECALLED" && (back?.n ?? 0) !== 0) warnings.push(`${line.barcode}: gold return row on a line that was not recalled`);
  }
  return { passed: warnings.length === 0, warnings };
}

export type TransferListRow = {
  id: string; number: string; from_branch_id: string; from_branch_name: string | null; to_branch_id: string; to_branch_name: string | null;
  status: string; reason: string | null; requested_by: string | null; requested_by_name: string | null; created_at: number;
  lines: number; in_transit: number; received: number;
};

export async function listTransfers(
  db: D1Database,
  opts: { fromBranchId?: string; toBranchId?: string; status?: string; scope: string[] | null }
): Promise<TransferListRow[]> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.fromBranchId) { conds.push("t.from_branch_id = ?"); vals.push(opts.fromBranchId); }
  if (opts.toBranchId) { conds.push("t.to_branch_id = ?"); vals.push(opts.toBranchId); }
  if (opts.status) { conds.push("t.status = ?"); vals.push(opts.status); }
  if (opts.scope !== null) {
    if (opts.scope.length === 0) return [];
    const qs = opts.scope.map(() => "?").join(",");
    conds.push(`(t.from_branch_id IN (${qs}) OR t.to_branch_id IN (${qs}))`);
    vals.push(...opts.scope, ...opts.scope);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT t.id, t.number, t.from_branch_id, bf.name AS from_branch_name, t.to_branch_id, bt.name AS to_branch_name, t.status, t.reason, t.requested_by, u.name AS requested_by_name, t.created_at,
              (SELECT COUNT(*) FROM transfer_lines l WHERE l.transfer_id = t.id) AS lines,
              (SELECT COUNT(*) FROM transfer_lines l WHERE l.transfer_id = t.id AND l.status = 'IN_TRANSIT') AS in_transit,
              (SELECT COUNT(*) FROM transfer_lines l WHERE l.transfer_id = t.id AND l.status = 'RECEIVED') AS received
       FROM transfers t LEFT JOIN branches bf ON bf.id = t.from_branch_id LEFT JOIN branches bt ON bt.id = t.to_branch_id LEFT JOIN users u ON u.id = t.requested_by
       ${where} ORDER BY t.created_at DESC LIMIT 100`
    )
    .bind(...vals)
    .all<TransferListRow>();
  return results ?? [];
}

/** The document as a person reads it: names instead of ids, and each line's piece. */
export async function getTransferDetail(db: D1Database, id: string) {
  const doc = await loadTransfer(db, id);
  const head = await db
    .prepare(
      `SELECT t.created_at, bf.name AS from_branch_name, bt.name AS to_branch_name, ur.name AS requested_by_name, ua.name AS approved_by_name
       FROM transfers t LEFT JOIN branches bf ON bf.id = t.from_branch_id LEFT JOIN branches bt ON bt.id = t.to_branch_id LEFT JOIN users ur ON ur.id = t.requested_by LEFT JOIN users ua ON ua.id = t.approved_by WHERE t.id = ?`
    )
    .bind(id)
    .first<{ created_at: number; from_branch_name: string | null; to_branch_name: string | null; requested_by_name: string | null; approved_by_name: string | null }>();
  const { results } = await db
    .prepare(
      `SELECT l.id, p.name, pu.karat, p.net_mg, p.status AS product_status FROM transfer_lines l JOIN products p ON p.id = l.product_id JOIN purities pu ON pu.id = p.purity_id WHERE l.transfer_id = ?`
    )
    .bind(id)
    .all<{ id: string; name: string; karat: string; net_mg: number; product_status: string }>();
  const info = new Map((results ?? []).map((r) => [r.id, r]));
  return {
    ...doc,
    createdAt: head?.created_at ?? null,
    fromBranchName: head?.from_branch_name ?? null,
    toBranchName: head?.to_branch_name ?? null,
    requestedByName: head?.requested_by_name ?? null,
    approvedByName: head?.approved_by_name ?? null,
    totalNetMg: (results ?? []).reduce((n, r) => n + r.net_mg, 0),
    lines: doc.lines.map((l) => {
      const i = info.get(l.id);
      return { ...l, name: i?.name ?? null, karat: i?.karat ?? null, netMg: i?.net_mg ?? null, productStatus: i?.product_status ?? null };
    }),
  };
}
