import {
  centsToLkr,
  extractScanCode,
  lkrToCents,
  normalizeCode,
  salesTaxCents,
  type CreateReturnInput,
  type CreateSaleInput,
} from "@goldos/shared";
import { getTaxConfig, TAX_PAYABLE } from "./taxes";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { priceFor } from "./products";
import { buildMoveStmts } from "./inventory";
import { assertCountLock } from "./counts";
import { getSetting } from "./settings";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
import { consumeApproval, pendingApproval, recordInlineApproval, requestApproval } from "./approvals";
import { customerBalance, moneyAccount, settlementStmt } from "./receipts";
import { allocateNumber } from "./counters";

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
  card: "1020",
  bank: "1010",
  other: "1010",
  credit: "1200",
};

/** Where a refund leaves from. A card refund clears 1020, not bank. */
const REFUND_ACCOUNT: Record<string, string> = {
  cash: "1000",
  card: "1020",
  bank: "1010",
  other: "1010",
};

export type ReceiveSaleOpts = {
  /**
   * The till must charge the shelf price. A line's `priceLkr` is then only
   * the price the cashier saw: if the rate or override moved since the scan
   * the sale is refused, so the cart can be refreshed. Without this a client
   * could post any price and walk round the discount limits. Internal callers
   * (custom-order delivery) price pieces by agreement and leave it off.
   */
  enforceShelfPrice?: boolean;
  /**
   * Refuse a credit leg that would take the customer past their credit limit
   * (when one is set). The till turns this on; custom-order delivery, whose
   * credit leg is the advance already paid, leaves it off.
   */
  enforceCreditLimit?: boolean;
  /**
   * Let store credit the customer already holds (a negative 1200 balance)
   * settle the credit leg. Default on. Custom-order delivery turns it off:
   * its credit leg is the advance, cleared by its own apply entry.
   */
  applyStoreCredit?: boolean;
};

type PayLeg = {
  method: CreateSaleInput["payments"][number]["method"];
  amountCents: number;
  accountCode: string;
  bankAccountId: string | null;
};

/**
 * The ledger account each till payment lands in. A bank payment that names
 * its bank account posts to that account's code, so the Cash & Bank balances
 * move with the sale; one that does not falls back to 1010, as before.
 */
async function resolvePayLegs(db: D1Database, payments: CreateSaleInput["payments"]): Promise<PayLeg[]> {
  const legs: PayLeg[] = [];
  for (const p of payments) {
    let accountCode = PAY_ACCOUNT[p.method]!;
    let bankAccountId: string | null = null;
    if (p.bankAccountId) {
      if (p.method !== "bank")
        throw Object.assign(new Error("Only a bank payment names a bank account"), { code: "VALIDATION" });
      const m = await moneyAccount(db, "bank", p.bankAccountId);
      accountCode = m.accountCode;
      bankAccountId = m.bankAccountId;
    }
    legs.push({ method: p.method, amountCents: lkrToCents(p.amountLkr), accountCode, bankAccountId });
  }
  return legs;
}

/** What the customer owes across every branch, from the control account. */
async function customerBalanceAllBranches(db: D1Database, customerId: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(debit_cents - credit_cents), 0) AS n FROM journal_lines WHERE account_code = '1200' AND party_type = 'customer' AND party_id = ?"
    )
    .bind(customerId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function receiveSale(
  db: D1Database,
  input: CreateSaleInput,
  actorId: string,
  opts: ReceiveSaleOpts = {}
): Promise<{ invoiceId: string; number: string }> {
  const now = Date.now();
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  let customer: { id: string; name: string; credit_limit_cents: number } | null = null;
  if (input.customerId) {
    customer = await db
      .prepare("SELECT id, name, credit_limit_cents FROM customers WHERE id = ? AND is_active = 1")
      .bind(input.customerId)
      .first<{ id: string; name: string; credit_limit_cents: number }>();
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
    taxCents: number;
  };
  // One tag is one piece: listing it twice would sell it twice.
  if (new Set(input.items.map((it) => it.productId)).size !== input.items.length)
    throw Object.assign(new Error("A piece appears more than once in the sale"), { code: "VALIDATION" });
  const tax = await getTaxConfig(db);
  const lines: Line[] = [];
  for (const it of input.items) {
    const p = await db
      .prepare(
        "SELECT p.id, p.barcode, p.status, p.reserved_customer_id, p.branch_id, p.net_mg, p.fine_gold_mg, p.making_cents, p.cost_cents, p.selling_price_cents, p.purity_id, pu.permille FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.id = ?"
      )
      .bind(it.productId)
      .first<{
        id: string;
        barcode: string;
        status: string;
        reserved_customer_id: string | null;
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
    // A held piece sells only to the customer it is held for; for anyone else
    // the hold has to be released first, deliberately.
    if (p.status === "RESERVED") {
      if (!customer || p.reserved_customer_id !== customer.id)
        throw Object.assign(new Error(`${p.barcode} is reserved for another customer`), { code: "VALIDATION" });
    } else if (p.status !== "IN_STOCK")
      throw Object.assign(new Error(`Product not available: ${it.productId}`), { code: "VALIDATION" });
    if (p.branch_id !== input.branchId)
      throw Object.assign(new Error(`Product not in branch: ${it.productId}`), { code: "VALIDATION" });
    // Unknown book cost means COGS would post zero and silently overstate the
    // margin. Cost the product first (PATCH /products/:id); an explicit zero
    // cost is an assertion the shop stands behind, an unknown one is not.
    if (p.cost_cents === null)
      throw Object.assign(new Error(`Product has no book cost: ${it.productId}`), { code: "VALIDATION" });
    await assertCountLock(db, p.id);
    // Shelf price: the selling-price override when set, else the live rate —
    // the same price the tag and the scan lookup show.
    const shelfPrice = async (): Promise<number> => {
      if (p.selling_price_cents !== null) return p.selling_price_cents;
      const { livePrice, noRate } = await priceFor(db, p.purity_id, p.net_mg, p.making_cents);
      if (noRate || !livePrice)
        throw Object.assign(new Error(`No rate for product: ${p.barcode}`), { code: "VALIDATION" });
      return livePrice.amount_cents;
    };
    let priceCents: number;
    if (it.priceLkr === undefined) {
      priceCents = await shelfPrice();
    } else {
      priceCents = lkrToCents(it.priceLkr);
      if (opts.enforceShelfPrice) {
        const shelf = await shelfPrice();
        if (shelf !== priceCents)
          throw Object.assign(
            new Error(
              `Price of ${p.barcode} is now ${centsToLkr(shelf).toLocaleString("en-US")} LKR (cart has ${centsToLkr(priceCents).toLocaleString("en-US")}) — refresh the cart`
            ),
            { code: "CONFLICT", productId: p.id, priceCents: shelf }
          );
      }
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
      // Tax is on the after-discount price, per line, added on top.
      taxCents: salesTaxCents(priceCents - discountCents, tax.rateBp),
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.priceCents, 0);
  const discount = lines.reduce((s, l) => s + l.discountCents, 0);
  const taxTotal = lines.reduce((s, l) => s + l.taxCents, 0);
  const net = subtotal - discount;
  if (net <= 0) throw Object.assign(new Error("Sale total must be positive"), { code: "VALIDATION" });
  // What the customer pays. Revenue is `net`; the tax is the authority's money.
  const total = net + taxTotal;

  const roles = await callerRoles(db, actorId);
  const limit = await discountLimit(db, roles);
  // Discount approval: unified engine first (config threshold), then the
  // legacy role limit. pct is rounded to 2dp so the approved terms bind
  // exactly across request and retry. Zero-discount sales skip the engine.
  const pct2 = Math.round(discountPct(discount, subtotal) * 100) / 100;
  if (input.approvalId) {
    await consumeApproval(
      db,
      { action: "SALES_DISCOUNT", id: input.approvalId, entity: "sale", entityId: input.approvalEntityId ?? "", metric: pct2 },
      actorId
    );
  } else if (pct2 > 0) {
    const req = await requestApproval(
      db,
      {
        action: "SALES_DISCOUNT",
        entity: "sale",
        entityId: crypto.randomUUID(),
        oldValue: { limitPct: limit },
        newValue: { discountPct: pct2 },
        metric: pct2,
        reason: `discount ${pct2}% on LKR sale`,
        branchId: input.branchId,
      },
      actorId
    );
    if (req.status === "PENDING") pendingApproval(req, "SALES_DISCOUNT");
  }
  if (!input.approvalId && pct2 > limit) {
    if (!input.approvedBy)
      throw Object.assign(new Error(`Discount exceeds your ${limit}% limit`), { code: "FORBIDDEN" });
    await requireApprover(db, input.approvedBy, actorId, "discount");
    await recordInlineApproval(
      db,
      {
        action: "SALES_DISCOUNT",
        entity: "sale",
        entityId: crypto.randomUUID(),
        oldValue: { limitPct: limit },
        newValue: { discountPct: pct2 },
        metric: pct2,
        reason: `discount ${pct2}% over ${limit}% limit`,
        branchId: input.branchId,
        approverId: input.approvedBy,
      },
      actorId
    );
  }

  const payTotal = input.payments.reduce((s, p) => s + lkrToCents(p.amountLkr), 0);
  if (payTotal !== total)
    throw Object.assign(
      new Error(`Payments must sum to total (${total}c${taxTotal > 0 ? `, incl. ${taxTotal}c ${tax.label}` : ""})`),
      { code: "VALIDATION" }
    );
  if (input.payments.some((p) => p.method === "credit") && !customer)
    throw Object.assign(new Error("Credit payment requires a customer"), { code: "VALIDATION" });
  const payLegs = await resolvePayLegs(db, input.payments);

  // The credit leg is new debt on 1200 — unless the customer already holds
  // store credit at this branch, which it draws down first.
  const creditCents = payLegs.filter((p) => p.method === "credit").reduce((s, p) => s + p.amountCents, 0);
  let storeCredit = 0;
  if (creditCents > 0 && customer) {
    if (opts.applyStoreCredit !== false) {
      const branchBalance = await customerBalance(db, customer.id, input.branchId);
      if (branchBalance < 0) storeCredit = Math.min(creditCents, -branchBalance);
    }
    if (opts.enforceCreditLimit && customer.credit_limit_cents > 0) {
      const owed = await customerBalanceAllBranches(db, customer.id);
      if (owed + creditCents > customer.credit_limit_cents)
        throw Object.assign(
          new Error(
            `${customer.name} would owe ${centsToLkr(owed + creditCents).toLocaleString("en-US")} LKR, over their ${centsToLkr(customer.credit_limit_cents).toLocaleString("en-US")} LKR credit limit`
          ),
          { code: "VALIDATION" }
        );
    }
  }

  const cashCents = payLegs.filter((p) => p.method === "cash").reduce((s, p) => s + p.amountCents, 0);
  let tenderedCents: number | null = null;
  if (input.tenderedLkr !== undefined && cashCents > 0) {
    tenderedCents = lkrToCents(input.tenderedLkr);
    if (tenderedCents < cashCents)
      throw Object.assign(new Error("Cash tendered is less than the cash due"), { code: "VALIDATION" });
  }

  // The replacement half of an exchange: the earlier EXCHANGE return is tied
  // to this sale in the same batch, so neither can exist without the other.
  if (input.exchangeReturnId) {
    const ret = await db
      .prepare(
        "SELECT r.id, r.type, r.exchange_sale_id, i.branch_id, i.customer_id FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id WHERE r.id = ?"
      )
      .bind(input.exchangeReturnId)
      .first<{ id: string; type: string; exchange_sale_id: string | null; branch_id: string; customer_id: string | null }>();
    if (!ret) throw Object.assign(new Error("Exchange return not found"), { code: "NOT_FOUND" });
    if (ret.type !== "EXCHANGE")
      throw Object.assign(new Error("Only EXCHANGE returns can link a sale"), { code: "VALIDATION" });
    if (ret.exchange_sale_id)
      throw Object.assign(new Error("Exchange return already linked to a sale"), { code: "CONFLICT" });
    if (ret.branch_id !== input.branchId)
      throw Object.assign(new Error("Exchange sale must be same branch"), { code: "VALIDATION" });
    if (ret.customer_id && ret.customer_id !== (customer?.id ?? null))
      throw Object.assign(new Error("Exchange sale must be for the same customer"), { code: "VALIDATION" });
  }

  const stmts: D1PreparedStatement[] = [];
  const number = await allocateNumber(db, "SINV", "SINV", 4, "sales_invoices");
  const invoiceId = crypto.randomUUID();

  stmts.push(
    db
      .prepare(
        // paid_cents and status are settled by settlementStmt at the end of
        // the batch, from the payments actually taken.
        "INSERT INTO sales_invoices (id, number, customer_id, branch_id, salesperson_id, subtotal_cents, discount_cents, tax_cents, tax_rate_bp, total_cents, paid_cents, status, store_credit_cents, tendered_cents, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'UNPAID', ?, ?, ?, ?, ?)"
      )
      .bind(invoiceId, number, customer?.id ?? null, input.branchId, salespersonId, subtotal, discount, taxTotal, taxTotal > 0 ? tax.rateBp : 0, total, storeCredit, tenderedCents, input.notes?.trim() || null, now, actorId)
  );
  let costTotal = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const itemId = crypto.randomUUID();
    costTotal += l.costCents;
    stmts.push(
      db
        .prepare(
          "INSERT INTO sales_items (id, invoice_id, product_id, price_cents, discount_cents, tax_cents, cost_cents) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(itemId, invoiceId, l.productId, l.priceCents, l.discountCents, l.taxCents, l.costCents)
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
    // A sale has to leave the gold ledger as well as the inventory table.
    // Without this the ledger has no SALE rows, so gold_sale can never match
    // the sales items and gold_stock_consistency overstates stock by every
    // gram the shop has sold.
    stmts.push(
      db
        .prepare(
          "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'SALE', ?, ?, ?, 'sale_invoice', ?, ?, NULL, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          now,
          input.branchId,
          `branch:${input.branchId}`,
          `sale:${number}`,
          l.netMg,
          l.permille,
          l.fineMg,
          invoiceId,
          l.productId,
          actorId,
          `Sale ${number}`,
          now,
          actorId
        )
    );
  }
  const journal = await buildEntryStmts(
    db,
    {
      refEntity: "sale_invoice",
      refId: invoiceId,
      refNo: number,
      lines: [
        ...payLegs.map((p) => ({
          account: p.accountCode,
          debitCents: p.amountCents,
          creditCents: 0,
          ...(p.method === "credit" && customer
            ? { partyType: "customer" as const, partyId: customer.id }
            : {}),
        })),
        { account: "4000", debitCents: 0, creditCents: net },
        ...(taxTotal > 0 ? [{ account: TAX_PAYABLE, debitCents: 0, creditCents: taxTotal }] : []),
        { account: "5000", debitCents: costTotal, creditCents: 0 },
        { account: "1100", debitCents: 0, creditCents: costTotal },
      ],
      memo: `Sale ${number}`,
      branchId: input.branchId,
      actorId,
      auditAction: "sale.complete",
      auditEntity: "sale_invoice",
      auditEntityId: invoiceId,
      sourceModule: "sales",
    },
    { entryDate: await businessDateFor(db, now) }
  );
  stmts.push(...journal.stmts);
  stmts.push(
    db
      .prepare("UPDATE sales_invoices SET journal_entry_id = ? WHERE id = ?")
      .bind(journal.entryId, invoiceId)
  );
  for (const p of payLegs) {
    const payId = crypto.randomUUID();
    stmts.push(
      db
        .prepare(
          "INSERT INTO sales_payments (id, invoice_id, amount_cents, method, account_code, bank_account_id, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'sale_payment', ?, ?, ?)"
        )
        .bind(payId, invoiceId, p.amountCents, p.method, p.accountCode, p.bankAccountId, payId, now, actorId)
    );
  }
  if (input.exchangeReturnId) {
    stmts.push(
      // Guarded so a concurrent link cannot overwrite the first one.
      db
        .prepare("UPDATE sales_returns SET exchange_sale_id = ? WHERE id = ? AND exchange_sale_id IS NULL")
        .bind(invoiceId, input.exchangeReturnId),
      buildAuditStmt(db, {
        userId: actorId,
        action: "sale.exchange_link",
        entity: "sale_return",
        entityId: input.exchangeReturnId,
        next: { exchange_sale_id: invoiceId },
        branchId: input.branchId,
      })
    );
  }
  stmts.push(settlementStmt(db, invoiceId));
  await db.batch(stmts);
  return { invoiceId, number };
}

/**
 * Resolve a scanned code to the sale it belongs to: an invoice number
 * (SINV-…, printed as a barcode on the invoice) or a product tag/SKU, which
 * finds the latest sale of that piece — how a returned piece is traced back
 * to its bill at the counter.
 */
export async function lookupSale(
  db: D1Database,
  code: string
): Promise<{ invoiceId: string; number: string; productId: string | null }> {
  const norm = extractScanCode(code);
  if (!norm) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
  if (norm.startsWith("SINV-")) {
    const inv = await db
      .prepare("SELECT id, number FROM sales_invoices WHERE number = ?")
      .bind(norm)
      .first<{ id: string; number: string }>();
    if (!inv) throw Object.assign(new Error(`No invoice ${norm}`), { code: "NOT_FOUND" });
    return { invoiceId: inv.id, number: inv.number, productId: null };
  }
  const row = await db
    .prepare(
      "SELECT i.id, i.number, p.id AS product_id FROM products p JOIN sales_items it ON it.product_id = p.id JOIN sales_invoices i ON i.id = it.invoice_id WHERE p.barcode = ? OR p.sku = ? ORDER BY i.created_at DESC LIMIT 1"
    )
    .bind(norm, norm)
    .first<{ id: string; number: string; product_id: string }>();
  if (!row) throw Object.assign(new Error(`No sale found for ${norm}`), { code: "NOT_FOUND" });
  return { invoiceId: row.id, number: row.number, productId: row.product_id };
}

/**
 * Who can sign off an over-limit discount or return at the counter: active
 * users holding sales:approve, other than the cashier asking. Names only —
 * the POS picks from this instead of typing a user id.
 */
export async function listApprovers(db: D1Database, exceptUserId: string) {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT u.id, u.name FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.name = 'sales:approve' AND u.is_active = 1 AND u.id <> ?
        ORDER BY u.name`
    )
    .bind(exceptUserId)
    .all<{ id: string; name: string }>();
  return results ?? [];
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
    .prepare("SELECT id, product_id, price_cents, discount_cents, tax_cents, cost_cents FROM sales_items WHERE invoice_id = ?")
    .bind(input.invoiceId)
    .all<{ id: string; product_id: string; price_cents: number; discount_cents: number; tax_cents: number; cost_cents: number }>();
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

  // The customer gets back what they paid for the item: its net price plus
  // exactly the tax that line carried. Revenue reverses the net only; the tax
  // comes back off 2100.
  const refundNet = targets.reduce((s, it) => s + (it.price_cents - it.discount_cents), 0);
  const refundTax = targets.reduce((s, it) => s + (it.tax_cents ?? 0), 0);
  const refundTotal = refundNet + refundTax;
  const revenueLegs = [
    { account: "4000", debitCents: refundNet, creditCents: 0 },
    ...(refundTax > 0 ? [{ account: TAX_PAYABLE, debitCents: refundTax, creditCents: 0 }] : []),
  ];
  const costTotal = targets.reduce((s, it) => s + it.cost_cents, 0);
  // Returns go through the unified engine. A FULL return cancels the sale
  // economically (there is no sale-void flow), so it records SALES_CANCEL;
  // PARTIAL/EXCHANGE record SALES_RETURN with the refund as metric.
  // NOTE: the legacy `return_approval_threshold` setting is superseded by
  // `approval_threshold_SALES_RETURN` (same default, LKR 100,000 in cents).
  const returnAction = input.type === "FULL" ? "SALES_CANCEL" : "SALES_RETURN";
  const returnMetric = input.type === "FULL" ? 1 : refundTotal;
  if (input.approvalId) {
    await consumeApproval(
      db,
      { action: returnAction, id: input.approvalId, entity: "sale", entityId: input.invoiceId, metric: returnMetric },
      actorId
    );
  } else {
    const req = await requestApproval(
      db,
      {
        action: returnAction,
        entity: "sale",
        entityId: input.invoiceId,
        oldValue: { invoiceTotalCents: inv.total_cents },
        newValue: { type: input.type, refundCents: refundTotal },
        metric: returnMetric,
        reason: input.reason,
        branchId: inv.branch_id,
      },
      actorId
    );
    if (req.status === "PENDING") pendingApproval(req, returnAction);
    if (input.approvedBy) {
      await requireApprover(db, input.approvedBy, actorId, "return");
      await recordInlineApproval(
        db,
        {
          action: returnAction,
          entity: "sale",
          entityId: input.invoiceId,
          oldValue: { invoiceTotalCents: inv.total_cents },
          newValue: { type: input.type, refundCents: refundTotal },
          metric: returnMetric,
          reason: input.reason,
          branchId: inv.branch_id,
          approverId: input.approvedBy,
        },
        actorId
      );
    }
  }
  const method = input.refundMethod ?? "original";
  const stmts: D1PreparedStatement[] = [];
  const number = await allocateNumber(db, "SRET", "SRET", 4, "sales_returns");
  const returnId = crypto.randomUUID();

  stmts.push(
    db
      .prepare(
        "INSERT INTO sales_returns (id, number, invoice_id, type, reason, approved_by, refund_cents, credit_cents, tax_cents, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETE', ?, ?)"
      )
      .bind(returnId, number, input.invoiceId, input.type, input.reason, input.approvedBy ?? null, method === "credit" ? 0 : refundTotal, method === "credit" ? refundTotal : 0, refundTax, now, actorId)
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
      .prepare("SELECT net_mg, fine_gold_mg, pu.permille AS purity_permille FROM products JOIN purities pu ON pu.id = products.purity_id WHERE products.id = ?")
      .bind(it.product_id)
      .first<{ net_mg: number; fine_gold_mg: number; purity_permille: number }>();
    if (p) {
      stmts.push(
        db
          .prepare("INSERT INTO gold_movements (id, product_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by) VALUES (?, ?, 'IN', ?, ?, 'sale_return', ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), it.product_id, p.fine_gold_mg, p.purity_permille, returnId, inv.branch_id, now, actorId)
      );
      // A return has to come back into the gold ledger as well as the
      // inventory table. Without this the ledger keeps the SALE outflow
      // while heldGold (which counts RETURNED) has the metal back, and
      // gold_stock_consistency fails by exactly the returned weight.
      // Direction mirrors SALE: SALE leaves branch→sale, RETURN returns
      // sale→branch so the branch nets back to whole.
      stmts.push(
        db
          .prepare(
            "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'RETURN', ?, ?, ?, 'sale_return', ?, ?, NULL, ?, ?, ?, ?)"
          )
          .bind(
            crypto.randomUUID(),
            now,
            inv.branch_id,
            `sale:${inv.id}`,
            `branch:${inv.branch_id}`,
            p.net_mg,
            p.purity_permille,
            p.fine_gold_mg,
            returnId,
            it.product_id,
            actorId,
            `Return ${number}`,
            now,
            actorId
          )
      );
    }
  }
  let refundLegs: { account: string; debitCents: number; creditCents: number; partyType?: "customer" | "supplier"; partyId?: string }[];
  if (method === "credit") {
    if (!inv.customer_id)
      throw Object.assign(new Error("Store credit requires a customer"), { code: "VALIDATION" });
    refundLegs = [...revenueLegs, { account: "1200", debitCents: 0, creditCents: refundTotal, partyType: "customer", partyId: inv.customer_id }];
  } else if (method === "original") {
    const { results: pays } = await db
      .prepare("SELECT method, amount_cents, account_code FROM sales_payments WHERE invoice_id = ?")
      .bind(input.invoiceId)
      .all<{ method: string; amount_cents: number; account_code: string | null }>();
    const invTotal = (allItems ?? []).reduce((s, it) => s + (it.price_cents - it.discount_cents + (it.tax_cents ?? 0)), 0);
    refundLegs = [...revenueLegs];
    if (invTotal > 0) {
      for (const p of pays ?? []) {
        const share = Math.floor((refundTotal * p.amount_cents) / invTotal);
        if (share <= 0) continue;
        // The part bought on credit was never paid in money: returning it
        // takes it off what the customer owes, it does not pay out of the bank.
        if (p.method === "credit" && inv.customer_id)
          refundLegs.push({ account: "1200", debitCents: 0, creditCents: share, partyType: "customer", partyId: inv.customer_id });
        else
          refundLegs.push({
            // Back out of the account the money went into at the till.
            account: p.method === "credit" ? "1010" : (p.account_code ?? REFUND_ACCOUNT[p.method] ?? "1010"),
            debitCents: 0,
            creditCents: share,
          });
      }
      const crSum = refundLegs.reduce((s, l) => s + l.creditCents, 0);
      if (crSum !== refundTotal) {
        // The rounding residue lands on the first money leg, which is no
        // longer refundLegs[1] once a tax leg can precede it.
        const first = refundLegs.find((l) => l.creditCents > 0);
        if (first) first.creditCents += refundTotal - crSum;
        else refundLegs.push({ account: "1000", debitCents: 0, creditCents: refundTotal - crSum });
      }
    } else {
      refundLegs.push({ account: "1000", debitCents: 0, creditCents: refundTotal });
    }
  } else {
    const cash =
      method === "bank" && input.refundBankAccountId
        ? (await moneyAccount(db, "bank", input.refundBankAccountId)).accountCode
        : (REFUND_ACCOUNT[method] ?? "1010");
    refundLegs = [...revenueLegs, { account: cash, debitCents: 0, creditCents: refundTotal }];
  }
  const reversal = await buildEntryStmts(
    db,
    {
      lines: [
        ...refundLegs,
        { account: "1100", debitCents: costTotal, creditCents: 0 },
        { account: "5000", debitCents: 0, creditCents: costTotal },
      ],
      refEntity: "sale_return",
      refId: returnId,
      refNo: number,
      memo: `Return ${number}`,
      branchId: inv.branch_id,
      actorId,
      auditAction: "sale.return",
      auditEntity: "sale_return",
      auditEntityId: returnId,
      sourceModule: "sales",
    },
    { entryDate: await businessDateFor(db, now) }
  );
  stmts.push(...reversal.stmts);
  stmts.push(
    db
      .prepare("UPDATE sales_returns SET journal_entry_id = ? WHERE id = ?")
      .bind(reversal.entryId, returnId)
  );
  // Credit the return put back on 1200 comes off this bill's balance due.
  stmts.push(settlementStmt(db, input.invoiceId));
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
    .prepare(
      "SELECT r.id, r.type, i.branch_id FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id WHERE r.id = ?"
    )
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

export async function listReturns(
  db: D1Database,
  opts: PageOpts & { invoiceId?: string; branchId?: string }
) {
  const offset = (opts.page - 1) * opts.limit;
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.invoiceId) {
    conds.push("r.invoice_id = ?");
    vals.push(opts.invoiceId);
  }
  if (opts.branchId) {
    conds.push("i.branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.search) {
    conds.push("(r.number LIKE ? OR i.number LIKE ?)");
    vals.push(`%${opts.search}%`, `%${opts.search}%`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT r.*, i.number AS invoice_number FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function getSale(db: D1Database, id: string) {
  const inv = await db
    .prepare(
      `SELECT i.*, i.total_cents - i.paid_cents AS balance_cents,
              c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone, c.address AS customer_address, c.nic AS customer_nic,
              u.name AS salesperson_name, cu.name AS cashier_name,
              b.name AS branch_name, b.code AS branch_code, b.address AS branch_address
       FROM sales_invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN users u ON u.id = i.salesperson_id
       LEFT JOIN users cu ON cu.id = i.created_by
       LEFT JOIN branches b ON b.id = i.branch_id
       WHERE i.id = ?`
    )
    .bind(id)
    .first();
  if (!inv) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
  const { results: items } = await db
    .prepare(
      "SELECT it.*, p.barcode, p.sku, p.name, p.gross_mg, p.stone_mg, p.net_mg, p.making_cents, p.purity_id, pu.karat, pu.permille, cat.name AS category_name FROM sales_items it JOIN products p ON p.id = it.product_id JOIN purities pu ON pu.id = p.purity_id LEFT JOIN categories cat ON cat.id = p.category_id WHERE it.invoice_id = ?"
    )
    .bind(id)
    .all();
  const { results: payments } = await db
    .prepare(
      "SELECT sp.*, ba.name AS bank_account_name, ba.bank_name FROM sales_payments sp LEFT JOIN bank_accounts ba ON ba.id = sp.bank_account_id WHERE sp.invoice_id = ? ORDER BY sp.created_at"
    )
    .bind(id)
    .all();
  // Money received later against this bill (credit sales).
  const { results: receipts } = await db
    .prepare(
      `SELECT r.id, r.number, r.receipt_date, r.method, r.status, a.amount_cents
       FROM customer_receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id
       WHERE a.invoice_id = ? ORDER BY r.receipt_date, r.created_at`
    )
    .bind(id)
    .all();
  // The ledger lines this bill posted — the sale and any returns against it —
  // so the invoice page shows exactly which accounts moved.
  const { results: journal } = await db
    .prepare(
      `SELECT l.id, l.account_code, coa.name AS account_name, l.debit_cents, l.credit_cents, e.memo, e.entry_no, e.ref_entity
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       LEFT JOIN chart_of_accounts coa ON coa.code = l.account_code
       WHERE (e.ref_entity = 'sale_invoice' AND e.ref_id = ?)
          OR (e.ref_entity = 'sale_payment' AND e.ref_id IN (SELECT id FROM sales_payments WHERE invoice_id = ?))
          OR (e.ref_entity = 'sale_return' AND e.ref_id IN (SELECT id FROM sales_returns WHERE invoice_id = ?))
       ORDER BY e.created_at, l.debit_cents DESC`
    )
    .bind(id, id, id)
    .all();
  const { results: returns } = await db
    .prepare("SELECT id, number, type, refund_cents, credit_cents, exchange_sale_id, status FROM sales_returns WHERE invoice_id = ? ORDER BY created_at")
    .bind(id)
    .all();
  // Lines already taken back; the return form offers only the rest.
  const { results: returnedItems } = await db
    .prepare(
      "SELECT ri.invoice_item_id FROM sales_return_items ri JOIN sales_returns r ON r.id = ri.return_id WHERE r.invoice_id = ?"
    )
    .bind(id)
    .all<{ invoice_item_id: string }>();
  // Set when this sale is the replacement half of an exchange.
  const exchangeOf = await db
    .prepare("SELECT r.id, r.number, i.id AS invoice_id, i.number AS invoice_number FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id WHERE r.exchange_sale_id = ?")
    .bind(id)
    .first();
  return {
    invoice: inv,
    items: items ?? [],
    payments: payments ?? [],
    receipts: receipts ?? [],
    journal: journal ?? [],
    returns: returns ?? [],
    returnedItemIds: (returnedItems ?? []).map((r) => r.invoice_item_id),
    exchangeOf: exchangeOf ?? null,
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
  const conds = ["(i.number LIKE ? OR i.customer_id IN (SELECT id FROM customers WHERE name LIKE ? OR phone LIKE ?))"];
  const vals: unknown[] = [like, like, like];
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
      `SELECT i.*, i.total_cents - i.paid_cents AS balance_cents, c.name AS customer_name FROM sales_invoices i LEFT JOIN customers c ON c.id = i.customer_id ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`
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
  const head = await db
    .prepare(
      `SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total_cents), 0) AS value_cents, COALESCE(SUM(i.discount_cents), 0) AS discount_cents,
              COALESCE(SUM(CASE WHEN i.status <> 'VOID' THEN i.total_cents - i.paid_cents ELSE 0 END), 0) AS due_cents
       FROM sales_invoices i ${where}`
    )
    .bind(...vals)
    .first<{ invoices: number; value_cents: number; discount_cents: number; due_cents: number }>();
  const gold = await db
    .prepare(
      `SELECT COALESCE(SUM(p.net_mg), 0) AS gold_mg FROM sales_items it JOIN products p ON p.id = it.product_id JOIN sales_invoices i ON i.id = it.invoice_id ${where}`
    )
    .bind(...vals)
    .first<{ gold_mg: number }>();
  return {
    invoices: head?.invoices ?? 0,
    value_cents: head?.value_cents ?? 0,
    discount_cents: head?.discount_cents ?? 0,
    due_cents: head?.due_cents ?? 0,
    gold_mg: gold?.gold_mg ?? 0,
  };
}

/**
 * Typed search at the till: pieces for sale at this branch whose name, tag,
 * SKU, category or karat matches, priced exactly as a scan would price them.
 * Pieces held for the selected customer are offered too.
 */
export async function posCatalog(
  db: D1Database,
  opts: { q: string; branchId: string; customerId?: string; limit?: number }
) {
  const q = opts.q.trim();
  if (q.length === 0) return [];
  const like = `%${q}%`;
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 30);
  const { results } = await db
    .prepare(
      `SELECT p.id, p.barcode, p.sku, p.name, p.status, p.net_mg, p.gross_mg, p.making_cents, p.cost_cents, p.selling_price_cents,
              p.purity_id, p.branch_id, p.reserved_customer_id, rc.name AS reserved_customer_name, pu.karat, c.name AS category_name
       FROM products p
       JOIN purities pu ON pu.id = p.purity_id
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN customers rc ON rc.id = p.reserved_customer_id
       WHERE p.branch_id = ?
         AND (p.status = 'IN_STOCK' OR (p.status = 'RESERVED' AND p.reserved_customer_id = ?))
         AND (p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ? OR c.name LIKE ? OR pu.karat LIKE ?)
       ORDER BY CASE WHEN p.barcode = ? OR p.sku = ? THEN 0 WHEN p.name LIKE ? THEN 1 ELSE 2 END, p.name
       LIMIT ?`
    )
    .bind(opts.branchId, opts.customerId ?? "", like, like, like, like, like, normalizeCode(q), normalizeCode(q), `${q}%`, limit)
    .all<{
      id: string;
      barcode: string;
      sku: string;
      name: string;
      status: string;
      net_mg: number;
      gross_mg: number;
      making_cents: number;
      cost_cents: number | null;
      selling_price_cents: number | null;
      purity_id: string;
      branch_id: string;
      reserved_customer_id: string | null;
      reserved_customer_name: string | null;
      karat: string;
      category_name: string;
    }>();
  const rows = [];
  for (const r of results ?? []) {
    const { livePrice } = r.selling_price_cents === null
      ? await priceFor(db, r.purity_id, r.net_mg, r.making_cents)
      : { livePrice: null };
    rows.push({ ...r, price_cents: r.selling_price_cents ?? livePrice?.amount_cents ?? null });
  }
  return rows;
}

/** Bank accounts a bank payment can land in: names only, for the till. */
export async function saleBankAccounts(db: D1Database, branchId?: string) {
  const { results } = await db
    .prepare(
      `SELECT id, name, bank_name, account_number, account_code, branch_id FROM bank_accounts
       WHERE is_active = 1 AND (branch_id IS NULL OR branch_id = ?) ORDER BY account_code`
    )
    .bind(branchId ?? "")
    .all<{ id: string; name: string; bank_name: string | null; account_number: string | null; account_code: string; branch_id: string | null }>();
  // The till needs to tell accounts apart, not read the full number.
  return (results ?? []).map((r) => ({
    ...r,
    account_number: r.account_number ? `••${r.account_number.slice(-4)}` : null,
  }));
}

/**
 * What the till needs to know before putting a bill on credit: what the
 * customer owes (negative = store credit to spend), their limit, and how
 * many bills are still open.
 */
export async function customerCredit(db: D1Database, customerId: string, branchId: string) {
  const c = await db
    .prepare("SELECT id, name, phone, credit_limit_cents FROM customers WHERE id = ?")
    .bind(customerId)
    .first<{ id: string; name: string; phone: string | null; credit_limit_cents: number }>();
  if (!c) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  const open = await db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(total_cents - paid_cents), 0) AS due FROM sales_invoices WHERE customer_id = ? AND status IN ('UNPAID','PARTIAL')"
    )
    .bind(customerId)
    .first<{ n: number; due: number }>();
  return {
    customerId: c.id,
    name: c.name,
    phone: c.phone,
    creditLimitCents: c.credit_limit_cents,
    balanceCents: await customerBalanceAllBranches(db, customerId),
    branchBalanceCents: await customerBalance(db, customerId, branchId),
    openInvoices: open?.n ?? 0,
    openDueCents: open?.due ?? 0,
  };
}

/** The shop's letterhead and terms, as the printed invoice shows them. */
export async function invoiceProfile(db: D1Database) {
  const str = async (key: string) => {
    const s = await getSetting(db, key);
    return typeof s?.value === "string" ? s.value.trim() : s?.value != null ? String(s.value) : "";
  };
  const tax = await getTaxConfig(db);
  return {
    shopName: (await str("shop_name")) || "GoldOS",
    header: await str("receipt_header"),
    footer: await str("receipt_footer"),
    address: await str("shop_address"),
    phone: await str("shop_phone"),
    email: await str("shop_email"),
    terms: await str("invoice_terms"),
    taxLabel: tax.label,
    taxRegNo: tax.registrationNo,
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
          ? "JOIN purities pu ON pu.id = p.purity_id"
          : opts.groupBy === "category"
            ? "JOIN categories c ON c.id = p.category_id"
            : opts.groupBy === "salesperson"
              ? "LEFT JOIN users u ON u.id = i.salesperson_id"
              : "");
  const bcond = opts.branchId ? "AND i.branch_id = ?" : "";
  const vals: unknown[] = opts.branchId ? [opts.from, opts.to, opts.branchId] : [opts.from, opts.to];
  const valueCol = opts.groupBy === "payment" ? "pay.amount_cents" : "it.price_cents - it.discount_cents";
  const mgCol = opts.groupBy === "payment" ? "0" : "p.net_mg";
  const countCol = opts.groupBy === "payment" ? "COUNT(*)" : "COUNT(DISTINCT i.id)";
  const { results } = await db
    .prepare(
      `SELECT ${col} AS key, ${countCol} AS invoices, COALESCE(SUM(${valueCol}), 0) AS value_cents, COALESCE(SUM(${mgCol}), 0) AS gold_mg FROM sales_invoices i ${join} WHERE i.created_at >= ? AND i.created_at <= ? ${bcond} GROUP BY ${col} ORDER BY value_cents DESC`
    )
    .bind(...vals)
    .all();
  return results ?? [];
}