import { lkrToCents, type CreateReturnInput, type CreateSaleInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { priceFor } from "./products";
import { buildMoveStmts } from "./inventory";
import { getSetting } from "./settings";
import { postJournalStmts } from "./journal";

export function discountPct(discountCents: number, subtotalCents: number): number {
  if (subtotalCents <= 0) throw new Error("subtotal must be positive");
  return (discountCents / subtotalCents) * 100;
}

const ROLE_DEFAULT_LIMITS: Record<string, number> = {
  cashier: 5,
  salesperson: 5,
  manager: 15,
  owner: 100,
  accountant: 0,
  inventory_officer: 0,
  gold_officer: 0,
  manufacturing_staff: 0,
};

async function callerRoles(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT role_id FROM user_roles WHERE user_id = ?")
    .bind(userId)
    .all<{ role_id: string }>();
  return (results ?? []).map((r) => r.role_id);
}

async function discountLimit(db: D1Database, roles: string[]): Promise<number> {
  let limit = 0;
  for (const role of roles) {
    const s = await getSetting(db, `discount_limit_${role}`);
    const v = typeof s?.value === "number" ? s.value : (ROLE_DEFAULT_LIMITS[role] ?? 0);
    if (v > limit) limit = v;
  }
  return limit;
}

async function requireApprover(
  db: D1Database,
  approverId: string,
  actorId: string,
  action: string
): Promise<void> {
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
  if (!(results ?? []).some((r) => r.name === "sales:approve"))
    throw Object.assign(new Error(`Approval requires sales:approve (${action})`), {
      code: "FORBIDDEN",
    });
}

const PAY_ACCOUNT: Record<string, string> = {
  cash: "1000",
  card: "1010",
  bank: "1010",
  other: "1010",
  credit: "1200",
};

export async function receiveSale(
  db: D1Database,
  input: CreateSaleInput,
  actorId: string
): Promise<{ invoiceId: string; number: string }> {
  const now = Date.now();
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  let customer: { id: string } | null = null;
  if (input.customerId) {
    customer = await db
      .prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1")
      .bind(input.customerId)
      .first<{ id: string }>();
    if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  }
  const salespersonId = input.salespersonId ?? actorId;
  const sp = await db
    .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1")
    .bind(salespersonId)
    .first();
  if (!sp) throw Object.assign(new Error("Salesperson not found"), { code: "NOT_FOUND" });

  type Line = {
    productId: string;
    netMg: number;
    fineMg: number;
    permille: number;
    costCents: number;
    priceCents: number;
    discountCents: number;
  };
  const lines: Line[] = [];
  for (const it of input.items) {
    const p = await db
      .prepare(
        "SELECT p.id, p.status, p.branch_id, p.net_mg, p.fine_gold_mg, p.making_cents, p.cost_cents, p.selling_price_cents, p.purity_id, pu.permille FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id = ?"
      )
      .bind(it.productId)
      .first<{
        id: string;
        status: string;
        branch_id: string;
        net_mg: number;
        fine_gold_mg: number;
        making_cents: number;
        cost_cents: number | null;
        selling_price_cents: number | null;
        purity_id: string;
        permille: number;
      }>();
    if (!p) throw Object.assign(new Error(`Product not found: ${it.productId}`), { code: "NOT_FOUND" });
    if (p.status !== "IN_STOCK")
      throw Object.assign(new Error(`Product not available: ${it.productId}`), { code: "VALIDATION" });
    if (p.branch_id !== input.branchId)
      throw Object.assign(new Error(`Product not in branch: ${it.productId}`), { code: "VALIDATION" });
    let priceCents: number;
    if (it.priceLkr !== undefined) {
      priceCents = lkrToCents(it.priceLkr);
    } else if (p.selling_price_cents !== null) {
      priceCents = p.selling_price_cents;
    } else {
      const { livePrice, noRate } = await priceFor(db, p.purity_id, p.net_mg, p.making_cents);
      if (noRate || !livePrice)
        throw Object.assign(new Error(`No rate for product: ${it.productId}`), { code: "VALIDATION" });
      priceCents = livePrice.amount_cents;
    }
    const discountCents = lkrToCents(it.discountLkr);
    if (discountCents > priceCents)
      throw Object.assign(new Error("Discount exceeds line price"), { code: "VALIDATION" });
    lines.push({
      productId: p.id,
      netMg: p.net_mg,
      fineMg: p.fine_gold_mg,
      permille: p.permille,
      costCents: p.cost_cents ?? 0,
      priceCents,
      discountCents,
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.priceCents, 0);
  const discount = lines.reduce((s, l) => s + l.discountCents, 0);
  const total = subtotal - discount;
  if (total <= 0) throw Object.assign(new Error("Sale total must be positive"), { code: "VALIDATION" });

  const roles = await callerRoles(db, actorId);
  const limit = await discountLimit(db, roles);
  if (discountPct(discount, subtotal) > limit) {
    if (!input.approvedBy)
      throw Object.assign(new Error(`Discount exceeds your ${limit}% limit`), { code: "FORBIDDEN" });
    await requireApprover(db, input.approvedBy, actorId, "discount");
  }

  const payTotal = input.payments.reduce((s, p) => s + lkrToCents(p.amountLkr), 0);
  if (payTotal !== total)
    throw Object.assign(new Error("Payments must sum to total"), { code: "VALIDATION" });
  if (input.payments.some((p) => p.method === "credit") && !customer)
    throw Object.assign(new Error("Credit payment requires a customer"), { code: "VALIDATION" });

  const stmts: D1PreparedStatement[] = [];
  const numRow = await db.prepare("SELECT next FROM counters WHERE name = 'SINV'").bind().first<{ next: number }>();
  if (!numRow) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'SINV'").bind(numRow.next + 1));
  const number = `SINV-${String(numRow.next).padStart(4, "0")}`;
  const invoiceId = crypto.randomUUID();

  stmts.push(
    db
      .prepare(
        "INSERT INTO sales_invoices (id, number, customer_id, branch_id, salesperson_id, subtotal_cents, discount_cents, total_cents, paid_cents, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?)"
      )
      .bind(invoiceId, number, customer?.id ?? null, input.branchId, salespersonId, subtotal, discount, total, total, now, actorId)
  );
  let costTotal = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const itemId = crypto.randomUUID();
    costTotal += l.costCents;
    stmts.push(
      db
        .prepare(
          "INSERT INTO sales_items (id, invoice_id, product_id, price_cents, discount_cents, cost_cents) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(itemId, invoiceId, l.productId, l.priceCents, l.discountCents, l.costCents)
    );
    const moved = await buildMoveStmts(db, l.productId, "SOLD", {
      actorId,
      now,
      auditAction: "sale.sold",
    });
    stmts.push(...moved.stmts);
    stmts.push(
      db
        .prepare(
          "INSERT INTO gold_movements (id, product_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by) VALUES (?, ?, 'OUT', ?, ?, 'sale_invoice', ?, ?, ?, ?)"
        )
        .bind(crypto.randomUUID(), l.productId, l.fineMg, l.permille, invoiceId, input.branchId, now, actorId)
    );
  }
  const journal = await postJournalStmts(db, {
    refEntity: "sale_invoice",
    refId: invoiceId,
    lines: [
      ...input.payments.map((p) => ({
        account: PAY_ACCOUNT[p.method]!,
        debitCents: lkrToCents(p.amountLkr),
        creditCents: 0,
        ...(p.method === "credit" && customer
          ? { partyType: "customer" as const, partyId: customer.id }
          : {}),
      })),
      { account: "4000", debitCents: 0, creditCents: total },
      { account: "5000", debitCents: costTotal, creditCents: 0 },
      { account: "1100", debitCents: 0, creditCents: costTotal },
    ],
    memo: `Sale ${number}`,
    branchId: input.branchId,
    actorId,
    auditAction: "sale.complete",
    auditEntity: "sale_invoice",
    auditEntityId: invoiceId,
  });
  stmts.push(...journal);
  for (const p of input.payments) {
    const payId = crypto.randomUUID();
    stmts.push(
      db
        .prepare(
          "INSERT INTO sales_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, ?, ?, 'sale_payment', ?, ?, ?)"
        )
        .bind(payId, invoiceId, lkrToCents(p.amountLkr), p.method, payId, now, actorId)
    );
  }
  await db.batch(stmts);
  return { invoiceId, number };
}

export async function createReturn(
  db: D1Database,
  input: CreateReturnInput,
  actorId: string
): Promise<{ returnId: string; number: string }> {
  const now = Date.now();
  const inv = await db
    .prepare("SELECT id, customer_id, branch_id, total_cents FROM sales_invoices WHERE id = ?")
    .bind(input.invoiceId)
    .first<{ id: string; customer_id: string | null; branch_id: string; total_cents: number }>();
  if (!inv) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  const { results: allItems } = await db
    .prepare("SELECT id, product_id, price_cents, discount_cents, cost_cents FROM sales_items WHERE invoice_id = ?")
    .bind(input.invoiceId)
    .all<{ id: string; product_id: string; price_cents: number; discount_cents: number; cost_cents: number }>();
  const { results: done } = await db
    .prepare("SELECT invoice_item_id FROM sales_return_items WHERE return_id IN (SELECT id FROM sales_returns WHERE invoice_id = ?)")
    .bind(input.invoiceId)
    .all<{ invoice_item_id: string }>();
  const doneSet = new Set((done ?? []).map((d) => d.invoice_item_id));
  let targets = (allItems ?? []).filter((it) => !doneSet.has(it.id));
  if (input.type !== "FULL") {
    if (!input.itemIds || input.itemIds.length === 0)
      throw Object.assign(new Error("itemIds required for partial/exchange"), { code: "VALIDATION" });
    const wanted = new Set(input.itemIds);
    targets = targets.filter((it) => wanted.has(it.id));
    if (targets.length !== wanted.size)
      throw Object.assign(new Error("Items already returned or not on invoice"), { code: "CONFLICT" });
  }
  if (targets.length === 0)
    throw Object.assign(new Error("Nothing left to return"), { code: "CONFLICT" });

  const refundTotal = targets.reduce((s, it) => s + (it.price_cents - it.discount_cents), 0);
  const costTotal = targets.reduce((s, it) => s + it.cost_cents, 0);
  const thresholdSetting = await getSetting(db, "return_approval_threshold");
  const threshold = typeof thresholdSetting?.value === "number" ? Math.round(thresholdSetting.value * 100) : 10000000;
  if (refundTotal >= threshold) {
    if (!input.approvedBy)
      throw Object.assign(new Error("Return exceeds approval threshold"), { code: "FORBIDDEN" });
    await requireApprover(db, input.approvedBy, actorId, "return");
  }
  const method = input.refundMethod ?? "original";
  const stmts: D1PreparedStatement[] = [];
  const numRow = await db.prepare("SELECT next FROM counters WHERE name = 'SRET'").bind().first<{ next: number }>();
  if (!numRow) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'SRET'").bind(numRow.next + 1));
  const number = `SRET-${String(numRow.next).padStart(4, "0")}`;
  const returnId = crypto.randomUUID();

  stmts.push(
    db
      .prepare(
        "INSERT INTO sales_returns (id, number, invoice_id, type, reason, approved_by, refund_cents, credit_cents, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETE', ?, ?)"
      )
      .bind(returnId, number, input.invoiceId, input.type, input.reason, input.approvedBy ?? null, method === "credit" ? 0 : refundTotal, method === "credit" ? refundTotal : 0, now, actorId)
  );
  for (const it of targets) {
    stmts.push(
      db
        .prepare("INSERT INTO sales_return_items (id, return_id, product_id, invoice_item_id) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), returnId, it.product_id, it.id)
    );
    const moved = await buildMoveStmts(db, it.product_id, "RETURNED", {
      reason: input.reason,
      actorId,
      now,
      auditAction: "sale.returned",
    });
    stmts.push(...moved.stmts);
    const p = await db
      .prepare("SELECT fine_gold_mg, purity_permille FROM products JOIN purities ON purities.id = products.purity_id WHERE products.id = ?")
      .bind(it.product_id)
      .first<{ fine_gold_mg: number; purity_permille: number }>();
    if (p) {
      stmts.push(
        db
          .prepare("INSERT INTO gold_movements (id, product_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by) VALUES (?, ?, 'IN', ?, ?, 'sale_return', ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), it.product_id, p.fine_gold_mg, p.purity_permille, returnId, inv.branch_id, now, actorId)
      );
    }
  }
  let refundLegs: { account: string; debitCents: number; creditCents: number; partyType?: "customer" | "supplier"; partyId?: string }[];
  if (method === "credit") {
    if (!inv.customer_id)
      throw Object.assign(new Error("Store credit requires a customer"), { code: "VALIDATION" });
    refundLegs = [{ account: "4000", debitCents: refundTotal, creditCents: 0 }, { account: "1200", debitCents: 0, creditCents: refundTotal, partyType: "customer", partyId: inv.customer_id }];
  } else if (method === "original") {
    const { results: pays } = await db
      .prepare("SELECT method, amount_cents FROM sales_payments WHERE invoice_id = ?")
      .bind(input.invoiceId)
      .all<{ method: string; amount_cents: number }>();
    const invTotal = (allItems ?? []).reduce((s, it) => s + (it.price_cents - it.discount_cents), 0);
    refundLegs = [{ account: "4000", debitCents: refundTotal, creditCents: 0 }];
    if (invTotal > 0) {
      for (const p of pays ?? []) {
        const share = Math.floor((refundTotal * p.amount_cents) / invTotal);
        if (share > 0)
          refundLegs.push({
            account: p.method === "cash" ? "1000" : "1010",
            debitCents: 0,
            creditCents: share,
          });
      }
      const crSum = refundLegs.reduce((s, l) => s + l.creditCents, 0);
      if (crSum !== refundTotal) {
        const first = refundLegs[1];
        if (first) first.creditCents += refundTotal - crSum;
      }
    } else {
      refundLegs.push({ account: "1000", debitCents: 0, creditCents: refundTotal });
    }
  } else {
    const cash = method === "cash" ? "1000" : "1010";
    refundLegs = [
      { account: "4000", debitCents: refundTotal, creditCents: 0 },
      { account: cash, debitCents: 0, creditCents: refundTotal },
    ];
  }
  const reversal = await postJournalStmts(db, {
    lines: [
      ...refundLegs,
      { account: "1100", debitCents: costTotal, creditCents: 0 },
      { account: "5000", debitCents: 0, creditCents: costTotal },
    ],
    refEntity: "sale_return",
    refId: returnId,
    memo: `Return ${number}`,
    branchId: inv.branch_id,
    actorId,
    auditAction: "sale.return",
    auditEntity: "sale_return",
    auditEntityId: returnId,
  });
  stmts.push(...reversal);
  await db.batch(stmts);
  return { returnId, number };
}

export async function linkExchange(
  db: D1Database,
  returnId: string,
  saleId: string,
  actorId: string
): Promise<void> {
  const ret = await db
    .prepare("SELECT id, type, branch_id FROM sales_returns WHERE id = ?")
    .bind(returnId)
    .first<{ id: string; type: string; branch_id: string }>();
  if (!ret) throw Object.assign(new Error("Return not found"), { code: "NOT_FOUND" });
  if (ret.type !== "EXCHANGE")
    throw Object.assign(new Error("Only EXCHANGE returns can link a sale"), { code: "VALIDATION" });
  const sale = await db
    .prepare("SELECT id, branch_id FROM sales_invoices WHERE id = ?")
    .bind(saleId)
    .first<{ id: string; branch_id: string }>();
  if (!sale) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
  if (sale.branch_id !== ret.branch_id)
    throw Object.assign(new Error("Exchange sale must be same branch"), { code: "VALIDATION" });
  await db.batch([
    db.prepare("UPDATE sales_returns SET exchange_sale_id = ? WHERE id = ?").bind(saleId, returnId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "sale.exchange_link",
      entity: "sale_return",
      entityId: returnId,
      next: { exchange_sale_id: saleId },
      branchId: ret.branch_id,
    }),
  ]);
}

export async function getSale(db: D1Database, id: string) {
  const inv = await db
    .prepare(
      "SELECT i.*, c.name AS customer_name, c.code AS customer_code, u.name AS salesperson_name FROM sales_invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = i.salesperson_id WHERE i.id = ?"
    )
    .bind(id)
    .first();
  if (!inv) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
  const { results: items } = await db
    .prepare(
      "SELECT it.*, p.barcode, p.sku, p.name, p.gross_mg, p.net_mg, p.purity_id, pu.karat FROM sales_items it JOIN products p ON p.id = it.product_id JOIN purities pu ON pu.id = p.purity_id WHERE it.invoice_id = ?"
    )
    .bind(id)
    .all();
  const { results: payments } = await db
    .prepare("SELECT * FROM sales_payments WHERE invoice_id = ? ORDER BY created_at")
    .bind(id)
    .all();
  const { results: journal } = await db
    .prepare(
      "SELECT * FROM journal_entries WHERE (ref_entity = 'sale_invoice' AND ref_id = ?) OR (ref_entity = 'sale_payment' AND ref_id IN (SELECT id FROM sales_payments WHERE invoice_id = ?)) ORDER BY created_at"
    )
    .bind(id, id)
    .all();
  const { results: returns } = await db
    .prepare("SELECT id, number, type, refund_cents, status FROM sales_returns WHERE invoice_id = ?")
    .bind(id)
    .all();
  return {
    invoice: inv,
    items: items ?? [],
    payments: payments ?? [],
    journal: journal ?? [],
    returns: returns ?? [],
  };
}

export async function listSales(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: PageOpts & { customerId?: string; branchId?: string; status?: string; from?: number; to?: number }
) {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(i.number LIKE ?)"];
  const vals: unknown[] = [like];
  if (opts.customerId) {
    conds.push("i.customer_id = ?");
    vals.push(opts.customerId);
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
    .prepare(`SELECT COUNT(*) AS total FROM sales_invoices i ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT i.*, c.name AS customer_name FROM sales_invoices i LEFT JOIN customers c ON c.id = i.customer_id ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function salesSummary(
  db: D1Database,
  opts: { from: number; to: number; branchId?: string }
) {
  const conds = ["i.created_at >= ?", "i.created_at <= ?"];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.branchId) {
    conds.push("i.branch_id = ?");
    vals.push(opts.branchId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total_cents), 0) AS value_cents, COALESCE(SUM(i.discount_cents), 0) AS discount_cents, COALESCE(SUM(it.net_mg), 0) AS gold_mg FROM sales_invoices i LEFT JOIN sales_items it ON it.invoice_id = i.id ${where}`
    )
    .bind(...vals)
    .first<{ invoices: number; value_cents: number; discount_cents: number; gold_mg: number }>();
  return {
    invoices: row?.invoices ?? 0,
    value_cents: row?.value_cents ?? 0,
    discount_cents: row?.discount_cents ?? 0,
    gold_mg: row?.gold_mg ?? 0,
  };
}

export async function salesBreakdown(
  db: D1Database,
  opts: {
    from: number;
    to: number;
    branchId?: string;
    groupBy: "category" | "purity" | "branch" | "salesperson" | "payment" | "product";
  }
) {
  const col =
    opts.groupBy === "category"
      ? "c.name"
      : opts.groupBy === "purity"
        ? "pu.karat"
        : opts.groupBy === "branch"
          ? "i.branch_id"
          : opts.groupBy === "salesperson"
            ? "u.name"
            : opts.groupBy === "payment"
              ? "pay.method"
              : "p.barcode";
  const join =
    opts.groupBy === "payment"
      ? "JOIN sales_payments pay ON pay.invoice_id = i.id"
      : "JOIN sales_items it ON it.invoice_id = i.id JOIN products p ON p.id = it.product_id " +
        (opts.groupBy === "purity"
          ? "JOIN purities pu ON pu.id = it.purity_id"
          : opts.groupBy === "category"
            ? "JOIN categories c ON c.id = p.category_id"
            : opts.groupBy === "salesperson"
              ? "LEFT JOIN users u ON u.id = i.salesperson_id"
              : "");
  const bcond = opts.branchId ? "AND i.branch_id = ?" : "";
  const vals: unknown[] = opts.branchId ? [opts.from, opts.to, opts.branchId] : [opts.from, opts.to];
  const valueCol = opts.groupBy === "payment" ? "pay.amount_cents" : "it.price_cents - it.discount_cents";
  const mgCol = opts.groupBy === "payment" ? "0" : "it.net_mg";
  const countCol = opts.groupBy === "payment" ? "COUNT(*)" : "COUNT(DISTINCT i.id)";
  const { results } = await db
    .prepare(
      `SELECT ${col} AS key, ${countCol} AS invoices, COALESCE(SUM(${valueCol}), 0) AS value_cents, COALESCE(SUM(${mgCol}), 0) AS gold_mg FROM sales_invoices i ${join} WHERE i.created_at >= ? AND i.created_at <= ? ${bcond} GROUP BY ${col} ORDER BY value_cents DESC`
    )
    .bind(...vals)
    .all();
  return results ?? [];
}