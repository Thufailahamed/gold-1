import { buildAuditStmt } from "../middleware/audit";
import { assertCountLock } from "./counts";

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
    lines.push({ productId: p.id, barcode: p.barcode });
  }
  const counter = await db.prepare("SELECT next FROM counters WHERE name = 'TRF'").bind().first<{ next: number }>();
  if (!counter) throw Object.assign(new Error("Counter TRF missing"), { code: "INTERNAL" });
  const number = `TRF-${String(counter.next).padStart(6, "0")}`;
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO transfers (id, number, from_branch_id, to_branch_id, status, reason, requested_by, created_at) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?)").bind(id, number, input.fromBranchId, input.toBranchId, input.reason ?? null, actorId, now),
    ...lines.map((l) => db.prepare("INSERT INTO transfer_lines (id, transfer_id, product_id, barcode, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', ?)").bind(crypto.randomUUID(), id, l.productId, l.barcode, now)),
    db.prepare("UPDATE counters SET next = ? WHERE name = 'TRF'").bind(counter.next + 1),
    buildAuditStmt(db, { userId: actorId, action: "transfer.request", entity: "transfer", entityId: id, next: { number, lines: lines.length } }),
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
