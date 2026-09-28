import { gToMg, lkrToCents } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";

export type RepairStatus = "RECEIVED" | "IN_PROGRESS" | "QC" | "READY" | "COLLECTED" | "CANCELLED";

const NEXT: Record<string, string[]> = {
  RECEIVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["QC", "CANCELLED"],
  QC: ["READY", "IN_PROGRESS", "CANCELLED"],
  READY: ["COLLECTED", "CANCELLED"],
  COLLECTED: [],
  CANCELLED: [],
};

async function transition(db: D1Database, id: string, to: RepairStatus, actorId: string, reason?: string, extra?: Record<string, unknown>): Promise<void> {
  const job = await db.prepare("SELECT id, status FROM repairs WHERE id = ?").bind(id).first<{ id: string; status: string }>();
  if (!job) throw Object.assign(new Error("Repair not found"), { code: "NOT_FOUND" });
  if (!(NEXT[job.status] ?? []).includes(to)) throw Object.assign(new Error(`Transition ${job.status} → ${to} not allowed`), { code: "CONFLICT" });
  if (to === "CANCELLED" && !reason?.trim()) throw Object.assign(new Error("Reason required to cancel"), { code: "VALIDATION" });
  const now = Date.now();
  const sets: string[] = ["status = ?"];
  const vals: unknown[] = [to];
  if (extra?.technicianId) { sets.push("technician_id = ?"); vals.push(extra.technicianId); }
  if (extra?.conditionOut) { sets.push("condition_out = ?"); vals.push(extra.conditionOut); }
  vals.push(id);
  await db.batch([
    db.prepare(`UPDATE repairs SET ${sets.join(", ")} WHERE id = ?`).bind(...vals),
    db.prepare("INSERT INTO repair_events (id, repair_id, from_status, to_status, actor_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, job.status, to, actorId, reason ?? null, now),
    buildAuditStmt(db, { userId: actorId, action: "repair.transition", entity: "repair", entityId: id, prev: { status: job.status }, next: { status: to }, reason }),
  ]);
}

export async function createRepair(db: D1Database, input: { customerId: string; branchId: string; itemDesc: string; weightG: number; conditionIn: string; repairType: string; estimateLkr: number }, actorId: string): Promise<{ id: string; number: string }> {
  if (!input.itemDesc.trim() || !input.conditionIn.trim() || !input.repairType.trim()) throw Object.assign(new Error("Item, condition and repair type required"), { code: "VALIDATION" });
  if (!(input.weightG > 0) || !(input.estimateLkr > 0)) throw Object.assign(new Error("Weight and estimate must be positive"), { code: "VALIDATION" });
  const customer = await db.prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1").bind(input.customerId).first();
  if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const counter = await db.prepare("SELECT next FROM counters WHERE name = 'RPR'").bind().first<{ next: number }>();
  if (!counter) throw Object.assign(new Error("Counter RPR missing"), { code: "INTERNAL" });
  const number = `RPR-${String(counter.next).padStart(6, "0")}`;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO repairs (id, number, customer_id, branch_id, item_desc, weight_mg, condition_in, repair_type, estimate_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?)").bind(id, number, input.customerId, input.branchId, input.itemDesc.trim(), gToMg(input.weightG), input.conditionIn.trim(), input.repairType.trim(), lkrToCents(input.estimateLkr), now),
    db.prepare("INSERT INTO repair_events (id, repair_id, from_status, to_status, actor_id, reason, created_at) VALUES (?, ?, 'RECEIVED', 'RECEIVED', ?, ?, ?)").bind(crypto.randomUUID(), id, actorId, "intake", now),
    db.prepare("UPDATE counters SET next = ? WHERE name = 'RPR'").bind(counter.next + 1),
    buildAuditStmt(db, { userId: actorId, action: "repair.create", entity: "repair", entityId: id, next: { number } }),
  ]);
  return { id, number };
}

export async function assignRepair(db: D1Database, id: string, technicianId: string, actorId: string): Promise<void> {
  const tech = await db.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").bind(technicianId).first();
  if (!tech) throw Object.assign(new Error("Technician not found"), { code: "NOT_FOUND" });
  await transition(db, id, "IN_PROGRESS", actorId, undefined, { technicianId });
}

export async function finishRepair(db: D1Database, id: string, actorId: string): Promise<void> {
  await transition(db, id, "QC", actorId);
}

export async function qcRepair(db: D1Database, id: string, pass: boolean, reason: string | undefined, actorId: string): Promise<void> {
  if (!pass && !reason?.trim()) throw Object.assign(new Error("Reason required on QC fail"), { code: "VALIDATION" });
  await transition(db, id, pass ? "READY" : "IN_PROGRESS", actorId, reason);
}

export async function cancelRepair(db: D1Database, id: string, reason: string, actorId: string): Promise<void> {
  await transition(db, id, "CANCELLED", actorId, reason);
}

export type RepairPayment = { method: "cash" | "card" | "bank" | "credit"; amountLkr: number; bankAccountId?: string };

async function paymentAccount(db: D1Database, p: RepairPayment): Promise<string> {
  if (p.method === "cash") return "1000";
  if (p.method === "card") return "1020";
  if (p.method === "credit") return "1200";
  if (p.bankAccountId) {
    const acct = await db.prepare("SELECT account_code FROM bank_accounts WHERE id = ? AND is_active = 1").bind(p.bankAccountId).first<{ account_code: string }>();
    if (!acct) throw Object.assign(new Error("Bank account not found"), { code: "NOT_FOUND" });
    return acct.account_code;
  }
  return "1010";
}

export async function collectRepair(db: D1Database, id: string, input: { payments: RepairPayment[]; actualLkr?: number; conditionOut: string }, actorId: string): Promise<{ entryId: string }> {
  const job = await db.prepare("SELECT id, status, customer_id, branch_id, estimate_cents FROM repairs WHERE id = ?").bind(id).first<{ id: string; status: string; customer_id: string; branch_id: string; estimate_cents: number }>();
  if (!job) throw Object.assign(new Error("Repair not found"), { code: "NOT_FOUND" });
  if (job.status !== "READY") throw Object.assign(new Error("Repair not ready for collection"), { code: "CONFLICT" });
  if (!input.conditionOut.trim()) throw Object.assign(new Error("After-condition required"), { code: "VALIDATION" });
  if (!input.payments.length) throw Object.assign(new Error("Payment required for collection"), { code: "VALIDATION" });
  const actualCents = input.actualLkr === undefined ? job.estimate_cents : lkrToCents(input.actualLkr);
  if (actualCents <= 0) throw Object.assign(new Error("Actual cost must be positive"), { code: "VALIDATION" });
  const billed = input.actualLkr === undefined ? "estimate" : "actual";
  const legs: { account: string; debitCents: number; creditCents: number; partyType?: "customer" | "supplier"; partyId?: string }[] = [];
  let paid = 0;
  for (const p of input.payments) {
    if (!(p.amountLkr > 0)) throw Object.assign(new Error("Payment amounts must be positive"), { code: "VALIDATION" });
    const cents = lkrToCents(p.amountLkr);
    paid += cents;
    legs.push({ account: await paymentAccount(db, p), debitCents: cents, creditCents: 0, ...(p.method === "credit" ? { partyType: "customer" as const, partyId: job.customer_id } : {}) });
  }
  if (paid !== actualCents) throw Object.assign(new Error("Payments must sum to the billed amount"), { code: "VALIDATION" });
  legs.push({ account: "4000", debitCents: 0, creditCents: actualCents });
  const now = Date.now();
  const entry = await buildEntryStmts(db, { lines: legs, refEntity: "repair", refId: id, memo: `Repair collection (${billed})`, branchId: job.branch_id, actorId, auditAction: "repair.collect", auditEntity: "repair", auditEntityId: id, sourceModule: "sales" }, { entryDate: await businessDateFor(db, now) });
  await db.batch([
    ...entry.stmts,
    db.prepare("UPDATE repairs SET status = 'COLLECTED', actual_cents = ?, condition_out = ? WHERE id = ? AND status = 'READY'").bind(actualCents, input.conditionOut.trim(), id),
    db.prepare("INSERT INTO repair_events (id, repair_id, from_status, to_status, actor_id, reason, created_at) VALUES (?, ?, 'READY', 'COLLECTED', ?, ?, ?)").bind(crypto.randomUUID(), id, actorId, `collected (${billed})`, now),
  ]);
  return { entryId: entry.entryId };
}

export async function getRepair(db: D1Database, id: string) {
  const job = await db.prepare("SELECT * FROM repairs WHERE id = ?").bind(id).first();
  if (!job) throw Object.assign(new Error("Repair not found"), { code: "NOT_FOUND" });
  const { results: events } = await db.prepare("SELECT * FROM repair_events WHERE repair_id = ? ORDER BY created_at").bind(id).all();
  const entry = await db.prepare("SELECT id, entry_no FROM journal_entries WHERE ref_entity = 'repair' AND ref_id = ?").bind(id).first<{ id: string; entry_no: string }>();
  return { job, events: events ?? [], journal: entry };
}

export async function listRepairs(db: D1Database, opts: { page: number; limit: number; branchId?: string; customerId?: string; status?: string }): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.branchId) { conds.push("branch_id = ?"); vals.push(opts.branchId); }
  if (opts.customerId) { conds.push("customer_id = ?"); vals.push(opts.customerId); }
  if (opts.status) { conds.push("status = ?"); vals.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM repairs ${where}`);
  const total = await (vals.length ? countStmt.bind(...vals) : countStmt).first<{ n: number }>();
  const offset = (opts.page - 1) * opts.limit;
  const listStmt = db.prepare(`SELECT id, number, customer_id, branch_id, item_desc, repair_type, estimate_cents, actual_cents, status, created_at FROM repairs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const { results } = await (vals.length ? listStmt.bind(...vals, opts.limit, offset) : listStmt.bind(opts.limit, offset)).all();
  return { rows: (results ?? []) as Record<string, unknown>[], total: total?.n ?? 0 };
}
