import { gToMg, lkrToCents } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
import { createOrder } from "./manufacturing";
import { receiveSale } from "./sales";

export type CustomStatus = "QUOTE" | "ADVANCED" | "IN_PRODUCTION" | "QC_PASSED" | "READY" | "DELIVERED" | "CANCELLED";

async function loadOrder(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM custom_orders WHERE id = ?").bind(id).first<{ id: string; number: string; customer_id: string; branch_id: string; design: string; gold_req_mg: number; gold_source: string; quote_cents: number; advance_cents: number; manufacturing_order_id: string | null; sale_id: string | null; status: string }>();
  if (!row) throw Object.assign(new Error("Custom order not found"), { code: "NOT_FOUND" });
  return row;
}

export async function createCustomOrder(db: D1Database, input: { customerId: string; branchId: string; design: string; description?: string; goldReqG: number; goldSource: "CUSTOMER" | "SHOP" | "MIXED"; quoteLkr: number }, actorId: string): Promise<{ id: string; number: string }> {
  if (!input.design.trim()) throw Object.assign(new Error("Design required"), { code: "VALIDATION" });
  if (!(input.goldReqG > 0) || !(input.quoteLkr > 0)) throw Object.assign(new Error("Gold requirement and quote must be positive"), { code: "VALIDATION" });
  const customer = await db.prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1").bind(input.customerId).first();
  if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const counter = await db.prepare("SELECT next FROM counters WHERE name = 'CORD'").bind().first<{ next: number }>();
  if (!counter) throw Object.assign(new Error("Counter CORD missing"), { code: "INTERNAL" });
  const number = `CORD-${String(counter.next).padStart(6, "0")}`;
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO custom_orders (id, number, customer_id, branch_id, design, description, gold_req_mg, gold_source, quote_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUOTE', ?)").bind(id, number, input.customerId, input.branchId, input.design.trim(), input.description ?? null, gToMg(input.goldReqG), input.goldSource, lkrToCents(input.quoteLkr), now),
    db.prepare("UPDATE counters SET next = ? WHERE name = 'CORD'").bind(counter.next + 1),
    buildAuditStmt(db, { userId: actorId, action: "cord.create", entity: "custom_order", entityId: id, next: { number } }),
  ]);
  return { id, number };
}

export async function advanceOrder(db: D1Database, id: string, input: { amountLkr: number; method: "cash" | "card" | "bank"; bankAccountId?: string }, actorId: string): Promise<{ advanceCents: number }> {
  const order = await loadOrder(db, id);
  if (!["QUOTE", "ADVANCED"].includes(order.status)) throw Object.assign(new Error("Advances accepted before production only"), { code: "CONFLICT" });
  if (!(input.amountLkr > 0)) throw Object.assign(new Error("Advance must be positive"), { code: "VALIDATION" });
  const cents = lkrToCents(input.amountLkr);
  if (order.advance_cents + cents > order.quote_cents) throw Object.assign(new Error(`Advance would exceed quote by ${order.advance_cents + cents - order.quote_cents}c`), { code: "CONFLICT" });
  let account = "1000";
  if (input.method === "card") account = "1020";
  if (input.method === "bank") {
    if (input.bankAccountId) {
      const acct = await db.prepare("SELECT account_code FROM bank_accounts WHERE id = ? AND is_active = 1").bind(input.bankAccountId).first<{ account_code: string }>();
      if (!acct) throw Object.assign(new Error("Bank account not found"), { code: "NOT_FOUND" });
      account = acct.account_code;
    } else account = "1010";
  }
  const now = Date.now();
  // custom_advance moves a cash/bank account only: the payments crossfoot keys
  // on sale/purchase/oldgold refs, so this entry is invisible to it (same
  // position as repair collections). The day-close guard names it via
  // KNOWN_CASH_REFS.
  const entry = await buildEntryStmts(db, { lines: [{ account, debitCents: cents, creditCents: 0 }, { account: "2200", debitCents: 0, creditCents: cents, partyType: "customer", partyId: order.customer_id }], refEntity: "custom_advance", refId: id, memo: `Advance ${order.number}`, branchId: order.branch_id, actorId, auditAction: "cord.advance", auditEntity: "custom_order", auditEntityId: id, sourceModule: "sales" }, { entryDate: await businessDateFor(db, now) });
  await db.batch([
    ...entry.stmts,
    db.prepare("UPDATE custom_orders SET advance_cents = ?, status = 'ADVANCED' WHERE id = ?").bind(order.advance_cents + cents, id),
    buildAuditStmt(db, { userId: actorId, action: "cord.advance.posted", entity: "custom_order", entityId: id, next: { advanceCents: order.advance_cents + cents } }),
  ]);
  return { advanceCents: order.advance_cents + cents };
}

export async function sourceGold(db: D1Database, id: string, kind: "CUSTOMER_OLDGOLD" | "SHOP_LOT", refId: string, actorId: string): Promise<void> {
  const order = await loadOrder(db, id);
  if (!["QUOTE", "ADVANCED"].includes(order.status)) throw Object.assign(new Error("Sourcing before production only"), { code: "CONFLICT" });
  let fineMg = 0;
  if (kind === "CUSTOMER_OLDGOLD") {
    const item = await db.prepare("SELECT id, customer_id, branch_id, fine_mg, status FROM old_gold_items WHERE id = ?").bind(refId).first<{ id: string; customer_id: string; branch_id: string; fine_mg: number; status: string }>();
    if (!item) throw Object.assign(new Error("Old gold item not found"), { code: "NOT_FOUND" });
    if (item.customer_id !== order.customer_id) throw Object.assign(new Error("Item belongs to another customer"), { code: "CONFLICT" });
    if (!["PURCHASED", "AVAILABLE"].includes(item.status)) throw Object.assign(new Error("Item must be purchased first"), { code: "CONFLICT" });
    fineMg = item.fine_mg;
  } else {
    const parts = refId.split("::");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw Object.assign(new Error("Shop lot ref must be batchId::lotNumber"), { code: "VALIDATION" });
    const [batchId, lotNumber] = parts as [string, string];
    const lot = await db.prepare("SELECT o.fine_mg, b.branch_id, b.status FROM melting_outputs o JOIN melting_batches b ON b.id = o.batch_id WHERE o.batch_id = ? AND o.lot_number = ?").bind(batchId, lotNumber).first<{ fine_mg: number; branch_id: string; status: string }>();
    if (!lot) throw Object.assign(new Error("Melt lot not found"), { code: "NOT_FOUND" });
    if (lot.status !== "APPROVED" || lot.branch_id !== order.branch_id) throw Object.assign(new Error("Lot not available in this branch"), { code: "CONFLICT" });
    fineMg = lot.fine_mg;
  }
  const now = Date.now();
  try {
    await db.batch([
      db.prepare("INSERT INTO custom_order_gold (id, order_id, kind, ref_id, fine_mg, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), id, kind, refId, fineMg, now),
      buildAuditStmt(db, { userId: actorId, action: "cord.source", entity: "custom_order", entityId: id, next: { kind, refId } }),
    ]);
  } catch {
    throw Object.assign(new Error("Already earmarked for this order"), { code: "CONFLICT" });
  }
}

export async function startProduction(db: D1Database, id: string, manufacturingOrderId: string | undefined, actorId: string): Promise<{ manufacturingOrderId: string }> {
  const order = await loadOrder(db, id);
  if (!["QUOTE", "ADVANCED"].includes(order.status)) throw Object.assign(new Error("Production already started"), { code: "CONFLICT" });
  let moId = manufacturingOrderId;
  if (moId) {
    const mo = await db.prepare("SELECT id, type, customer_id, branch_id, status FROM manufacturing_orders WHERE id = ?").bind(moId).first<{ id: string; type: string; customer_id: string | null; branch_id: string; status: string }>();
    if (!mo || mo.type !== "CUSTOMER" || mo.customer_id !== order.customer_id || mo.branch_id !== order.branch_id || mo.status !== "DRAFT")
      throw Object.assign(new Error("Linked order must be a DRAFT customer order for this customer and branch"), { code: "CONFLICT" });
  } else {
    moId = (await createOrder(db, { type: "CUSTOMER", customerId: order.customer_id, branchId: order.branch_id, design: order.design, description: `Custom order ${order.number}` }, actorId)).id;
  }
  await db.batch([
    db.prepare("UPDATE custom_orders SET manufacturing_order_id = ?, status = 'IN_PRODUCTION' WHERE id = ?").bind(moId, id),
    buildAuditStmt(db, { userId: actorId, action: "cord.produce", entity: "custom_order", entityId: id, next: { manufacturingOrderId: moId } }),
  ]);
  return { manufacturingOrderId: moId! };
}

export async function syncOrder(db: D1Database, id: string, actorId: string): Promise<{ status: string }> {
  const order = await loadOrder(db, id);
  if (!order.manufacturing_order_id || !["IN_PRODUCTION", "QC_PASSED"].includes(order.status)) return { status: order.status };
  const mo = await db.prepare("SELECT status FROM manufacturing_orders WHERE id = ?").bind(order.manufacturing_order_id).first<{ status: string }>();
  const next = mo?.status === "QC_PASSED" ? "QC_PASSED" : mo?.status === "COMPLETE" ? "READY" : order.status;
  if (next !== order.status) {
    await db.batch([
      db.prepare("UPDATE custom_orders SET status = ? WHERE id = ?").bind(next, id),
      buildAuditStmt(db, { userId: actorId, action: "cord.sync", entity: "custom_order", entityId: id, next: { status: next } }),
    ]);
  }
  return { status: next };
}

export async function cancelCustomOrder(db: D1Database, id: string, reason: string, actorId: string): Promise<void> {
  const order = await loadOrder(db, id);
  if (["READY", "DELIVERED", "CANCELLED"].includes(order.status)) throw Object.assign(new Error("Too late to cancel; deliver or reverse"), { code: "CONFLICT" });
  if (!reason?.trim()) throw Object.assign(new Error("Reason required"), { code: "VALIDATION" });
  const now = Date.now();
  const { results: legs } = await db.prepare("SELECT account_code, debit_cents FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.ref_entity = 'custom_advance' AND e.ref_id = ? AND l.debit_cents > 0").bind(id).all<{ account_code: string; debit_cents: number }>();
  const stmts: D1PreparedStatement[] = [];
  if ((legs ?? []).length) {
    if (!(legs ?? []).every((l) => l.account_code === "1000"))
      throw Object.assign(new Error("Non-cash advances need manual reversal before cancel"), { code: "CONFLICT" });
    const total = (legs ?? []).reduce((s, l) => s + l.debit_cents, 0);
    const entry = await buildEntryStmts(db, { lines: [{ account: "2200", debitCents: total, creditCents: 0, partyType: "customer", partyId: order.customer_id }, { account: "1000", debitCents: 0, creditCents: total }], refEntity: "custom_advance_refund", refId: id, memo: `Advance refund ${order.number}: ${reason}`, branchId: order.branch_id, actorId, auditAction: "cord.refund", auditEntity: "custom_order", auditEntityId: id, sourceModule: "sales" }, { entryDate: await businessDateFor(db, now) });
    stmts.push(...entry.stmts);
  }
  stmts.push(
    db.prepare("UPDATE custom_orders SET status = 'CANCELLED' WHERE id = ?").bind(id),
    buildAuditStmt(db, { userId: actorId, action: "cord.cancel", entity: "custom_order", entityId: id, reason })
  );
  await db.batch(stmts);
}

export async function getCustomOrder(db: D1Database, id: string) {
  const order = await loadOrder(db, id);
  const { results: gold } = await db.prepare("SELECT kind, ref_id, fine_mg FROM custom_order_gold WHERE order_id = ?").bind(id).all();
  return { order, gold: gold ?? [] };
}

export async function deliverOrder(db: D1Database, id: string, input: { payments: { method: "cash" | "card" | "bank" | "credit" | "other"; amountLkr: number }[] }, actorId: string): Promise<{ invoiceId: string }> {
  const order = await loadOrder(db, id);
  if (order.status !== "READY") throw Object.assign(new Error("Order not ready"), { code: "CONFLICT" });
  if (!order.manufacturing_order_id) throw Object.assign(new Error("No linked production"), { code: "CONFLICT" });
  const { results: finished } = await db.prepare("SELECT product_id FROM manufacturing_outputs WHERE order_id = ? AND product_id IS NOT NULL").bind(order.manufacturing_order_id).all<{ product_id: string }>();
  if (!finished?.length) throw Object.assign(new Error("No finished piece"), { code: "CONFLICT" });
  const now = Date.now();
  // The advance already moved as real money (DR cash / CR 2200). The sale must
  // still total the full quote, so the applied advance rides along as an
  // auto credit leg: it DRs 1200, which nets against the apply entry's CR
  // 1200 below. Caller legs must sum to exactly quote − advances.
  const applyCents = Math.min(order.advance_cents, order.quote_cents);
  const balanceCents = order.quote_cents - applyCents;
  let callerPaid = 0;
  for (const p of input.payments) {
    if (!(p.amountLkr > 0)) throw Object.assign(new Error("Payment amounts must be positive"), { code: "VALIDATION" });
    callerPaid += lkrToCents(p.amountLkr);
  }
  if (callerPaid !== balanceCents) throw Object.assign(new Error(`Balance payments must sum to the unpaid ${balanceCents}c`), { code: "VALIDATION" });
  const salePayments = [...input.payments];
  if (applyCents > 0) salePayments.push({ method: "credit", amountLkr: applyCents / 100 });
  const quoteLkr = order.quote_cents / 100;
  const perPiece = quoteLkr / finished.length;
  const sale = await receiveSale(db, { branchId: order.branch_id, customerId: order.customer_id, items: finished.map((f) => ({ productId: f.product_id, priceLkr: perPiece, discountLkr: 0 })), payments: salePayments }, actorId);
  const stmts: D1PreparedStatement[] = [];
  if (applyCents > 0) {
    const apply = await buildEntryStmts(db, { lines: [{ account: "2200", debitCents: applyCents, creditCents: 0, partyType: "customer", partyId: order.customer_id }, { account: "1200", debitCents: 0, creditCents: applyCents, partyType: "customer", partyId: order.customer_id }], refEntity: "custom_advance_apply", refId: id, memo: `Advance applied ${order.number}`, branchId: order.branch_id, actorId, auditAction: "cord.apply", auditEntity: "custom_order", auditEntityId: id, sourceModule: "sales" }, { entryDate: await businessDateFor(db, now) });
    stmts.push(...apply.stmts);
  }
  stmts.push(
    db.prepare("UPDATE custom_orders SET status = 'DELIVERED', sale_id = ? WHERE id = ? AND status = 'READY'").bind(sale.invoiceId, id),
    buildAuditStmt(db, { userId: actorId, action: "cord.deliver", entity: "custom_order", entityId: id, next: { saleId: sale.invoiceId } })
  );
  await db.batch(stmts);
  return { invoiceId: sale.invoiceId };
}

export async function orderLineage(db: D1Database, id: string) {
  const order = await loadOrder(db, id);
  const { results: gold } = await db.prepare("SELECT kind, ref_id FROM custom_order_gold WHERE order_id = ?").bind(id).all<{ kind: string; ref_id: string }>();
  const mo = order.manufacturing_order_id ? await db.prepare("SELECT id, number, status FROM manufacturing_orders WHERE id = ?").bind(order.manufacturing_order_id).first() : null;
  const sale = order.sale_id ? await db.prepare("SELECT id, number, total_cents FROM sales_invoices WHERE id = ?").bind(order.sale_id).first() : null;
  return { order: { id: order.id, number: order.number, status: order.status }, gold: gold ?? [], manufacturing: mo, sale };
}

export async function listCustomOrders(db: D1Database, opts: { page: number; limit: number; branchId?: string; customerId?: string; status?: string }) {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.branchId) { conds.push("branch_id = ?"); vals.push(opts.branchId); }
  if (opts.customerId) { conds.push("customer_id = ?"); vals.push(opts.customerId); }
  if (opts.status) { conds.push("status = ?"); vals.push(opts.status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM custom_orders ${where}`);
  const total = await (vals.length ? countStmt.bind(...vals) : countStmt).first<{ n: number }>();
  const offset = (opts.page - 1) * opts.limit;
  const listStmt = db.prepare(`SELECT id, number, customer_id, branch_id, design, gold_source, quote_cents, advance_cents, status, created_at FROM custom_orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const { results } = await (vals.length ? listStmt.bind(...vals, opts.limit, offset) : listStmt.bind(opts.limit, offset)).all();
  return { rows: (results ?? []) as Record<string, unknown>[], total: total?.n ?? 0 };
}
