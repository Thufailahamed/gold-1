import {
  allocateProportional,
  fineGoldMg,
  gToMg,
  lkrToCents,
  type CreateInvoiceInput,
  type CreateOrderInput,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { buildEntryStmts, reverseEntry } from "./journal";
import { businessDateFor } from "./busdate";
import { buildCreateProductStmts, buildVoidProductStmts } from "./products";

/** @deprecated Use `allocateProportional` from @goldos/shared directly. */
export const allocateCharges = allocateProportional;

async function nextNumber(
  db: D1Database,
  stmts: D1PreparedStatement[],
  name: string,
  prefix: string
): Promise<string> {
  const row = await db
    .prepare("SELECT next FROM counters WHERE name = ?")
    .bind(name)
    .first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  const n = row.next;
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = ?").bind(n + 1, name));
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

type IntakeItem = {
  categoryId: string;
  subcategoryId?: string;
  designId?: string;
  productTypeId?: string;
  metalTypeId: string;
  stoneTypeId?: string;
  purityId: string;
  name: string;
  grossMg: number;
  stoneMg: number;
  netMg: number;
  makingCents: number;
  wastageMg: number;
  costCents: number;
  location?: string;
  notes?: string;
};

async function receiveBatch(
  db: D1Database,
  opts: {
    supplierId: string;
    branchId: string;
    orderId: string | null;
    items: IntakeItem[];
    chargesCents: number;
    paidCents: number;
    paidMethod?: "cash" | "bank";
    actorId: string;
    now: number;
  }
): Promise<{ invoiceId: string; number: string }> {
  const supplier = await db
    .prepare("SELECT id FROM suppliers WHERE id = ? AND is_active = 1")
    .bind(opts.supplierId)
    .first();
  if (!supplier) throw Object.assign(new Error("Supplier not found"), { code: "NOT_FOUND" });
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(opts.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const subtotal = opts.items.reduce((s, it) => s + it.costCents, 0);
  const total = subtotal + opts.chargesCents;
  if (opts.paidCents > total)
    throw Object.assign(new Error("Payment exceeds total"), { code: "VALIDATION" });
  if (opts.paidCents > 0 && !opts.paidMethod)
    throw Object.assign(new Error("Payment method required"), { code: "VALIDATION" });

  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "PINV", "PINV");
  const invoiceId = crypto.randomUUID();
  const shares = allocateCharges(
    opts.chargesCents,
    opts.items.map((it) => it.netMg)
  );
  const itemRows: {
    id: string;
    productId: string;
    grossMg: number;
    netMg: number;
    purityId: string;
    costCents: number;
    makingCents: number;
  }[] = [];
  for (let i = 0; i < opts.items.length; i++) {
    const it = opts.items[i]!;
    const built = await buildCreateProductStmts(
      db,
      {
        name: it.name,
        categoryId: it.categoryId,
        subcategoryId: it.subcategoryId,
        designId: it.designId,
        productTypeId: it.productTypeId,
        metalTypeId: it.metalTypeId,
        stoneTypeId: it.stoneTypeId,
        purityId: it.purityId,
        grossG: it.grossMg / 1000,
        stoneG: it.stoneMg / 1000,
        makingLkr: it.makingCents / 100,
        wastageG: it.wastageMg / 1000,
        costLkr: (it.costCents + (shares[i] ?? 0)) / 100,
        location: it.location,
        notes: it.notes,
        branchId: opts.branchId,
      },
      opts.actorId,
      opts.branchId,
      opts.now
    );
    stmts.push(...built.stmts);
    itemRows.push({
      id: crypto.randomUUID(),
      productId: built.id,
      grossMg: it.grossMg,
      netMg: it.netMg,
      purityId: it.purityId,
      costCents: it.costCents + (shares[i] ?? 0),
      makingCents: it.makingCents,
    });
  }
  const status = opts.paidCents === 0 ? "UNPAID" : opts.paidCents === total ? "PAID" : "PARTIAL";
  stmts.push(
    db
      .prepare(
        "INSERT INTO purchase_invoices (id, number, order_id, supplier_id, branch_id, subtotal_cents, charges_cents, total_cents, paid_cents, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        invoiceId,
        number,
        opts.orderId,
        opts.supplierId,
        opts.branchId,
        subtotal,
        opts.chargesCents,
        total,
        opts.paidCents,
        status,
        opts.now,
        opts.actorId
      )
  );
  for (const r of itemRows) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO purchase_invoice_items (id, invoice_id, product_id, gross_mg, net_mg, purity_id, cost_cents, making_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(r.id, invoiceId, r.productId, r.grossMg, r.netMg, r.purityId, r.costCents, r.makingCents)
    );
    // A catalogue purchase has to reach the gold ledger as well as the
    // inventory table. Without this the ledger has no PURCHASE rows at all,
    // so gold_stock_consistency can never close and gold_purchase always
    // fails against the invoice items it is supposed to match.
    const purity = await db
      .prepare("SELECT permille FROM purities WHERE id = ?")
      .bind(r.purityId)
      .first<{ permille: number }>();
    if (!purity) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
    const fineMg = fineGoldMg(r.netMg, purity.permille);
    stmts.push(
      db
        .prepare(
          "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'PURCHASE', ?, ?, ?, 'purchase_invoice', ?, ?, NULL, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          opts.now,
          opts.branchId,
          `purchase:${number}`,
          `branch:${opts.branchId}`,
          r.netMg,
          purity.permille,
          fineMg,
          invoiceId,
          r.productId,
          opts.actorId,
          `Purchase ${number}`,
          opts.now,
          opts.actorId
        )
    );
  }
  const journal = await buildEntryStmts(
    db,
    {
      lines: [
        { account: "1100", debitCents: total, creditCents: 0, partyType: "supplier", partyId: opts.supplierId },
        { account: "2000", debitCents: 0, creditCents: total, partyType: "supplier", partyId: opts.supplierId },
      ],
      refEntity: "purchase_invoice",
      refId: invoiceId,
      refNo: number,
      memo: `Purchase ${number}`,
      branchId: opts.branchId,
      actorId: opts.actorId,
      auditAction: "purchase.receive",
      auditEntity: "purchase_invoice",
      auditEntityId: invoiceId,
      sourceModule: "purchases",
    },
    { entryDate: await businessDateFor(db, opts.now) }
  );
  stmts.push(...journal.stmts);
  stmts.push(
    db
      .prepare("UPDATE purchase_invoices SET journal_entry_id = ? WHERE id = ?")
      .bind(journal.entryId, invoiceId)
  );
  if (opts.paidCents > 0) {
    const payId = crypto.randomUUID();
    const cash = opts.paidMethod === "cash" ? "1000" : "1010";
    stmts.push(
      db
        .prepare(
          "INSERT INTO purchase_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, ?, ?, 'purchase_payment', ?, ?, ?)"
        )
        .bind(payId, invoiceId, opts.paidCents, opts.paidMethod, payId, opts.now, opts.actorId)
    );
    const payJournal = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "2000", debitCents: opts.paidCents, creditCents: 0, partyType: "supplier", partyId: opts.supplierId },
          { account: cash, debitCents: 0, creditCents: opts.paidCents },
        ],
        refEntity: "purchase_payment",
        refId: payId,
        refNo: `${number} / pay`,
        memo: `Payment for ${number}`,
        branchId: opts.branchId,
        actorId: opts.actorId,
        auditAction: "purchase.pay",
        auditEntity: "purchase_payment",
        auditEntityId: payId,
        sourceModule: "purchases",
      },
      { entryDate: await businessDateFor(db, opts.now) }
    );
    stmts.push(...payJournal.stmts);
  }
  await db.batch(stmts);
  return { invoiceId, number };
}

export async function createOrder(
  db: D1Database,
  input: CreateOrderInput,
  actorId: string
): Promise<{ id: string; number: string }> {
  const supplier = await db
    .prepare("SELECT id FROM suppliers WHERE id = ? AND is_active = 1")
    .bind(input.supplierId)
    .first();
  if (!supplier) throw Object.assign(new Error("Supplier not found"), { code: "NOT_FOUND" });
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  for (const it of input.items) {
    await db
      .prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1")
      .bind(it.categoryId)
      .first()
      .then((r) => {
        if (!r) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
      });
    await db
      .prepare("SELECT id FROM purities WHERE id = ? AND is_active = 1")
      .bind(it.purityId)
      .first()
      .then((r) => {
        if (!r) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
      });
    if (gToMg(it.grossG) <= 0)
      throw Object.assign(new Error("Gross weight must be positive"), { code: "VALIDATION" });
  }
  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "PO", "PO");
  const id = crypto.randomUUID();
  const now = Date.now();
  stmts.push(
    db
      .prepare(
        "INSERT INTO purchase_orders (id, number, supplier_id, branch_id, status, notes, created_at, created_by) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?)"
      )
      .bind(id, number, input.supplierId, input.branchId, input.notes ?? null, now, actorId)
  );
  for (const it of input.items) {
    const grossMg = gToMg(it.grossG);
    stmts.push(
      db
        .prepare(
          "INSERT INTO purchase_order_items (id, order_id, category_id, purity_id, gross_mg, net_mg, est_cost_cents, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          id,
          it.categoryId,
          it.purityId,
          grossMg,
          grossMg,
          lkrToCents(it.estCostLkr),
          it.notes ?? null
        )
    );
  }
  stmts.push(
    buildAuditStmt(db, {
      userId: actorId,
      action: "purchase.order_create",
      entity: "purchase_order",
      entityId: id,
      next: { number, items: input.items.length },
      branchId: input.branchId,
    })
  );
  await db.batch(stmts);
  return { id, number };
}

export async function cancelOrder(
  db: D1Database,
  orderId: string,
  reason: string,
  actorId: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, status, branch_id FROM purchase_orders WHERE id = ?")
    .bind(orderId)
    .first<{ id: string; status: string; branch_id: string }>();
  if (!prev) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  if (prev.status !== "DRAFT" && prev.status !== "SENT")
    throw Object.assign(new Error("Only draft/sent orders can be cancelled"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = ?").bind(orderId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "purchase.order_cancel",
      entity: "purchase_order",
      entityId: orderId,
      prev: { status: prev.status },
      next: { status: "CANCELLED" },
      reason,
      branchId: prev.branch_id,
    }),
  ]);
}

export async function receiveOrder(
  db: D1Database,
  orderId: string,
  opts: { chargesLkr?: number; paidLkr?: number; paidMethod?: "cash" | "bank" },
  actorId: string
): Promise<{ invoiceId: string; number: string }> {
  const order = await db
    .prepare("SELECT id, supplier_id, branch_id, status FROM purchase_orders WHERE id = ?")
    .bind(orderId)
    .first<{ id: string; supplier_id: string; branch_id: string; status: string }>();
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  if (order.status !== "DRAFT" && order.status !== "SENT")
    throw Object.assign(new Error("Order already received or cancelled"), { code: "CONFLICT" });
  const { results: items } = await db
    .prepare(
      "SELECT category_id, purity_id, gross_mg, net_mg, est_cost_cents, notes FROM purchase_order_items WHERE order_id = ?"
    )
    .bind(orderId)
    .all<{
      category_id: string;
      purity_id: string;
      gross_mg: number;
      net_mg: number;
      est_cost_cents: number;
      notes: string | null;
    }>();
  if (!items || items.length === 0)
    throw Object.assign(new Error("Order has no items"), { code: "VALIDATION" });
  const now = Date.now();
  const metal = await db
    .prepare("SELECT id FROM metal_types WHERE code = 'GOLD' AND is_active = 1")
    .bind()
    .first<{ id: string }>();
  const metalTypeId = metal?.id ?? "metal-gold";
  const res = await receiveBatch(db, {
    supplierId: order.supplier_id,
    branchId: order.branch_id,
    orderId,
    items: items.map((it, i) => ({
      categoryId: it.category_id,
      purityId: it.purity_id,
      metalTypeId,
      name: `Purchase item ${i + 1}`,
      grossMg: it.gross_mg,
      stoneMg: 0,
      netMg: it.net_mg,
      makingCents: 0,
      wastageMg: 0,
      costCents: it.est_cost_cents,
      notes: it.notes ?? undefined,
    })),
    chargesCents: lkrToCents(opts.chargesLkr ?? 0),
    paidCents: lkrToCents(opts.paidLkr ?? 0),
    paidMethod: opts.paidMethod,
    actorId,
    now,
  });
  await db.batch([
    db.prepare("UPDATE purchase_orders SET status = 'RECEIVED' WHERE id = ?").bind(orderId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "purchase.order_receive",
      entity: "purchase_order",
      entityId: orderId,
      next: { status: "RECEIVED", invoiceId: res.invoiceId },
      branchId: order.branch_id,
    }),
  ]);
  return res;
}

export async function createInvoiceDirect(
  db: D1Database,
  input: CreateInvoiceInput,
  actorId: string
): Promise<{ invoiceId: string; number: string }> {
  if (input.orderId) {
    const linked = await db
      .prepare("SELECT id FROM purchase_invoices WHERE order_id = ? AND status != 'VOID'")
      .bind(input.orderId)
      .first();
    if (linked)
      throw Object.assign(new Error("Order already invoiced"), { code: "CONFLICT" });
  }
  return receiveBatch(db, {
    supplierId: input.supplierId,
    branchId: input.branchId,
    orderId: input.orderId ?? null,
    items: input.items.map((it) => ({
      categoryId: it.categoryId,
      subcategoryId: it.subcategoryId,
      designId: it.designId,
      productTypeId: it.productTypeId,
      metalTypeId: it.metalTypeId,
      stoneTypeId: it.stoneTypeId,
      purityId: it.purityId,
      name: it.name,
      grossMg: gToMg(it.grossG),
      stoneMg: gToMg(it.stoneG),
      netMg: gToMg(it.grossG) - gToMg(it.stoneG),
      makingCents: lkrToCents(it.makingLkr),
      wastageMg: gToMg(it.wastageG),
      costCents: lkrToCents(it.costLkr),
      location: it.location,
      notes: it.notes,
    })),
    chargesCents: lkrToCents(input.chargesLkr),
    paidCents: lkrToCents(input.paidLkr),
    paidMethod: input.paidMethod,
    actorId,
    now: Date.now(),
  });
}

export async function payInvoice(
  db: D1Database,
  invoiceId: string,
  amountCents: number,
  method: "cash" | "bank",
  actorId: string
): Promise<{ paidCents: number; status: string }> {
  const inv = await db
    .prepare(
      "SELECT id, supplier_id, branch_id, total_cents, paid_cents, status FROM purchase_invoices WHERE id = ?"
    )
    .bind(invoiceId)
    .first<{
      id: string;
      supplier_id: string;
      branch_id: string;
      total_cents: number;
      paid_cents: number;
      status: string;
    }>();
  if (!inv) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  if (inv.status === "VOID")
    throw Object.assign(new Error("Void invoices cannot be paid"), { code: "CONFLICT" });
  if (amountCents <= 0 || inv.paid_cents + amountCents > inv.total_cents)
    throw Object.assign(new Error("Payment exceeds outstanding"), { code: "VALIDATION" });
  const now = Date.now();
  const payId = crypto.randomUUID();
  const cash = method === "cash" ? "1000" : "1010";
  const paid = inv.paid_cents + amountCents;
  const status = paid === 0 ? "UNPAID" : paid === inv.total_cents ? "PAID" : "PARTIAL";
  const journal = await buildEntryStmts(
    db,
    {
      lines: [
        { account: "2000", debitCents: amountCents, creditCents: 0, partyType: "supplier", partyId: inv.supplier_id },
        { account: cash, debitCents: 0, creditCents: amountCents },
      ],
      refEntity: "purchase_payment",
      refId: payId,
      refNo: `Payment for invoice ${inv.id}`,
      memo: `Payment for invoice ${inv.id}`,
      branchId: inv.branch_id,
      actorId,
      auditAction: "purchase.pay",
      auditEntity: "purchase_payment",
      auditEntityId: payId,
      sourceModule: "purchases",
    },
    { entryDate: await businessDateFor(db, now) }
  );
  await db.batch([
    db
      .prepare(
        "INSERT INTO purchase_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, ?, ?, 'purchase_payment', ?, ?, ?)"
      )
      .bind(payId, invoiceId, amountCents, method, payId, now, actorId),
    db
      .prepare("UPDATE purchase_invoices SET paid_cents = ?, status = ? WHERE id = ?")
      .bind(paid, status, invoiceId),
    ...journal.stmts,
  ]);
  return { paidCents: paid, status };
}

export async function voidInvoice(
  db: D1Database,
  invoiceId: string,
  reason: string,
  actorId: string
): Promise<void> {
  const inv = await db
    .prepare(
      "SELECT id, supplier_id, branch_id, total_cents, paid_cents, status, journal_entry_id FROM purchase_invoices WHERE id = ?"
    )
    .bind(invoiceId)
    .first<{
      id: string;
      supplier_id: string;
      branch_id: string;
      total_cents: number;
      paid_cents: number;
      status: string;
      journal_entry_id: string | null;
    }>();
  if (!inv) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  if (inv.status === "VOID")
    throw Object.assign(new Error("Invoice already void"), { code: "CONFLICT" });
  // A void reverses the RECEIVE posting only. Any payment already taken stays
  // posted and becomes a genuine payable to the supplier, so voiding an
  // invoice with payments against it would silently drop money.
  if (inv.paid_cents > 0)
    throw Object.assign(new Error("Invoice has payments; reverse them before voiding"), {
      code: "CONFLICT",
    });
  const { results: items } = await db
    .prepare("SELECT product_id FROM purchase_invoice_items WHERE invoice_id = ?")
    .bind(invoiceId)
    .all<{ product_id: string }>();
  for (const it of items ?? []) {
    const p = await db
      .prepare("SELECT status FROM products WHERE id = ?")
      .bind(it.product_id)
      .first<{ status: string }>();
    if (!p || p.status !== "IN_STOCK")
      throw Object.assign(new Error("Invoice cannot be voided: items moved"), { code: "CONFLICT" });
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const it of items ?? []) {
    const built = await buildVoidProductStmts(db, it.product_id, actorId, `invoice void: ${reason}`, now);
    stmts.push(...built.stmts);
  }
  let entryId = inv.journal_entry_id;
  if (!entryId) {
    const earliest = await db
      .prepare(
        "SELECT id FROM journal_entries WHERE ref_entity = 'purchase_invoice' AND ref_id = ? ORDER BY created_at, id LIMIT 1"
      )
      .bind(invoiceId)
      .first<{ id: string }>();
    if (!earliest)
      throw Object.assign(new Error("Invoice has no journal entry to reverse"), { code: "NOT_FOUND" });
    entryId = earliest.id;
  }
  const reversal = await reverseEntry(db, entryId, {
    reason,
    entryDate: await businessDateFor(db, now),
    actorId,
  });
  stmts.push(...reversal.stmts);
  stmts.push(
    db.prepare("UPDATE purchase_invoices SET status = 'VOID' WHERE id = ?").bind(invoiceId)
  );
  await db.batch(stmts);
}

export async function getInvoice(db: D1Database, id: string) {
  const inv = await db
    .prepare(
      "SELECT i.*, s.name AS supplier_name, s.code AS supplier_code FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ?"
    )
    .bind(id)
    .first();
  if (!inv) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  const { results: itemRows } = await db
    .prepare(
      "SELECT it.*, p.barcode, p.sku, p.name FROM purchase_invoice_items it JOIN products p ON p.id = it.product_id WHERE it.invoice_id = ?"
    )
    .bind(id)
    .all();
  const { results: payments } = await db
    .prepare("SELECT * FROM purchase_payments WHERE invoice_id = ? ORDER BY created_at")
    .bind(id)
    .all();
  const { results: journal } = await db
    .prepare(
      "SELECT * FROM journal_entries WHERE (ref_entity = 'purchase_invoice' AND ref_id = ?) OR (ref_entity = 'purchase_payment' AND ref_id IN (SELECT id FROM purchase_payments WHERE invoice_id = ?)) ORDER BY created_at"
    )
    .bind(id, id)
    .all();
  return { invoice: inv, items: itemRows ?? [], payments: payments ?? [], journal: journal ?? [] };
}

export async function listInvoices(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: PageOpts & { supplierId?: string; branchId?: string; status?: string; from?: number; to?: number }
) {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(i.number LIKE ?)"];
  const vals: unknown[] = [like];
  if (opts.supplierId) {
    conds.push("i.supplier_id = ?");
    vals.push(opts.supplierId);
  }
  if (opts.branchId) {
    conds.push("i.branch_id = ?");
    vals.push(opts.branchId);
  } else if (!canManageAll) {
    conds.push("i.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)");
    vals.push(userId);
  }
  if (opts.status) {
    conds.push("i.status = ?");
    vals.push(opts.status);
  }
  if (opts.from !== undefined) {
    conds.push("i.created_at >= ?");
    vals.push(opts.from);
  }
  if (opts.to !== undefined) {
    conds.push("i.created_at <= ?");
    vals.push(opts.to);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM purchase_invoices i ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT i.*, s.name AS supplier_name FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function listOrders(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: PageOpts & { supplierId?: string; branchId?: string; status?: string }
) {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(o.number LIKE ?)"];
  const vals: unknown[] = [like];
  if (opts.supplierId) {
    conds.push("o.supplier_id = ?");
    vals.push(opts.supplierId);
  }
  if (opts.branchId) {
    conds.push("o.branch_id = ?");
    vals.push(opts.branchId);
  } else if (!canManageAll) {
    conds.push("o.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)");
    vals.push(userId);
  }
  if (opts.status) {
    conds.push("o.status = ?");
    vals.push(opts.status);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM purchase_orders o ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT o.*, s.name AS supplier_name, (SELECT COUNT(*) FROM purchase_order_items WHERE order_id = o.id) AS items FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function getOrder(db: D1Database, id: string) {
  const order = await db
    .prepare(
      "SELECT o.*, s.name AS supplier_name FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = ?"
    )
    .bind(id)
    .first();
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  const { results: items } = await db
    .prepare("SELECT * FROM purchase_order_items WHERE order_id = ?")
    .bind(id)
    .all();
  return { order, items: items ?? [] };
}

export async function purchaseSummary(
  db: D1Database,
  opts: { from: number; to: number; supplierId?: string; branchId?: string }
) {
  const conds = ["i.created_at >= ?", "i.created_at <= ?", "i.status != 'VOID'"];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.supplierId) {
    conds.push("i.supplier_id = ?");
    vals.push(opts.supplierId);
  }
  if (opts.branchId) {
    conds.push("i.branch_id = ?");
    vals.push(opts.branchId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const head = await db
    .prepare(
      `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total_cents), 0) AS value_cents, COALESCE(SUM(i.paid_cents), 0) AS paid_cents FROM purchase_invoices i ${where}`
    )
    .bind(...vals)
    .first<{ invoices: number; value_cents: number; paid_cents: number }>();
  const gold = await db
    .prepare(
      `SELECT COALESCE(SUM(it.net_mg), 0) AS gold_mg FROM purchase_invoice_items it JOIN purchase_invoices i ON i.id = it.invoice_id ${where}`
    )
    .bind(...vals)
    .first<{ gold_mg: number }>();
  return {
    invoices: head?.invoices ?? 0,
    value_cents: head?.value_cents ?? 0,
    paid_cents: head?.paid_cents ?? 0,
    outstanding_cents: (head?.value_cents ?? 0) - (head?.paid_cents ?? 0),
    gold_mg: gold?.gold_mg ?? 0,
  };
}

export async function purchaseBreakdown(
  db: D1Database,
  opts: { from: number; to: number; branchId?: string; groupBy: "supplier" | "purity" | "category" }
) {
  const col =
    opts.groupBy === "supplier"
      ? "s.name"
      : opts.groupBy === "purity"
        ? "pu.karat"
        : "c.name";
  const join =
    opts.groupBy === "supplier"
      ? "JOIN suppliers s ON s.id = i.supplier_id"
      : "JOIN purchase_invoice_items it ON it.invoice_id = i.id JOIN products p ON p.id = it.product_id " +
        (opts.groupBy === "purity"
          ? "JOIN purities pu ON pu.id = it.purity_id"
          : "JOIN categories c ON c.id = p.category_id");
  const extra = opts.groupBy === "supplier" ? "" : " AND it.id IS NOT NULL";
  const bcond = opts.branchId ? "AND i.branch_id = ?" : "";
  const vals: unknown[] = opts.branchId ? [opts.from, opts.to, opts.branchId] : [opts.from, opts.to];
  const valueCol = opts.groupBy === "supplier" ? "i.total_cents" : "it.cost_cents";
  const mgCol = opts.groupBy === "supplier" ? "0" : "it.net_mg";
  const { results } = await db
    .prepare(
      `SELECT ${col} AS key, COUNT(DISTINCT i.id) AS invoices, COALESCE(SUM(${valueCol}), 0) AS value_cents, COALESCE(SUM(${mgCol}), 0) AS gold_mg FROM purchase_invoices i ${join} WHERE i.created_at >= ? AND i.created_at <= ? AND i.status != 'VOID' ${extra} ${bcond} GROUP BY ${col} ORDER BY value_cents DESC`
    )
    .bind(...vals)
    .all();
  return results ?? [];
}