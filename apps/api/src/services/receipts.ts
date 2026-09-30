import { agingBuckets, allocateReceipt, type CustomerReceiptInput, type OpenInvoice } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { businessDateFor } from "./busdate";
import { fail } from "./cashbank";
import { buildEntryStmts, reverseEntry } from "./journal";

const RECEIVABLES = "1200";
const CASH = "1000";
const CARD_CLEARING = "1020";
const LOCAL_DATE = (col: string) => `date(${col}/1000,'unixepoch','+330 minutes')`;

/**
 * A delivered custom order carries its advance into the sale as a 'credit'
 * leg, then clears it straight off 1200 with a custom_advance_apply entry.
 * The ledger nets to zero, but per-invoice arithmetic would still see the
 * credit leg as unpaid — so the applied advance counts as received.
 * Expects the invoice alias `si`.
 */
export const APPLIED_ADVANCE_SQL = `COALESCE((SELECT SUM(al.credit_cents) FROM custom_orders co
  JOIN journal_entries ae ON ae.ref_entity = 'custom_advance_apply' AND ae.ref_id = co.id
  JOIN journal_lines al ON al.entry_id = ae.id AND al.account_code = '1200'
  WHERE co.sale_id = si.id), 0)`;

/**
 * Credit a return put back on 1200 against this invoice: a credit sale taken
 * back, or store credit issued. Either way the customer no longer owes it on
 * this bill. Expects the invoice alias `si`.
 */
export const RETURN_CREDIT_SQL = `COALESCE((SELECT SUM(rl.credit_cents) FROM sales_returns sr
  JOIN journal_lines rl ON rl.entry_id = sr.journal_entry_id AND rl.account_code = '1200'
  WHERE sr.invoice_id = si.id), 0)`;

const TILL_PAID_SQL = `COALESCE((SELECT SUM(sp.amount_cents) FROM sales_payments sp WHERE sp.invoice_id = si.id AND sp.method <> 'credit'), 0)`;
const RECEIPTS_APPLIED_SQL = `COALESCE((SELECT SUM(a.amount_cents) FROM customer_receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id
  WHERE a.invoice_id = si.id AND r.status = 'POSTED'), 0)`;

/**
 * Everything that has settled an invoice other than money at the till.
 * One definition, so the invoice's own status, the open-invoice list and the
 * receipt allocator never disagree about what is still owed.
 */
const RECEIVED_SQL = `(${RECEIPTS_APPLIED_SQL} + ${APPLIED_ADVANCE_SQL} + ${RETURN_CREDIT_SQL} + si.store_credit_cents)`;
const SETTLED_SQL = `(${TILL_PAID_SQL} + ${RECEIVED_SQL})`;

/**
 * Recompute an invoice's paid_cents and status from what has actually
 * settled it. Queue it after every write that changes that — the sale itself,
 * a receipt, a receipt void, a return, an applied advance — in the same batch
 * and after the rows it reads.
 */
export function settlementStmt(db: D1Database, invoiceId: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sales_invoices AS si SET
         paid_cents = MIN(si.total_cents, ${SETTLED_SQL}),
         status = CASE
           WHEN si.status = 'VOID' THEN 'VOID'
           WHEN ${SETTLED_SQL} >= si.total_cents THEN 'PAID'
           WHEN ${SETTLED_SQL} > 0 THEN 'PARTIAL'
           ELSE 'UNPAID' END
       WHERE si.id = ?`
    )
    .bind(invoiceId);
}

export type ReceivableRow = {
  customerId: string;
  name: string;
  phone: string | null;
  balanceCents: number;
  openInvoices: number;
  oldestOpenDate: string | null;
  aging: { "0-30": number; "31-60": number; "61-90": number; "90+": number };
};

export type OpenInvoiceRow = OpenInvoice & { number: string; totalCents: number; branchId: string };

export type ReceiptRow = {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  branch_id: string;
  receipt_date: string;
  amount_cents: number;
  method: string;
  account_code: string;
  note: string | null;
  status: string;
  void_reason: string | null;
  journal_entry_id: string | null;
  created_at: number;
};

/**
 * What a customer owes at a branch, straight from the control account. Every
 * entry counts regardless of status: a voided receipt and its mirror both
 * stay on the ledger and net to zero, so filtering either one out would show
 * a phantom debt.
 */
export async function customerBalance(db: D1Database, customerId: string, branchId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '${RECEIVABLES}' AND l.party_type = 'customer' AND l.party_id = ? AND e.branch_id = ?`
    )
    .bind(customerId, branchId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Open credit invoices: total, less what was paid at the till (not the
 * 'credit' leg — that is the debt itself), less receipts already applied.
 * Same arithmetic as the monthly receivables list, so the two never disagree.
 */
async function openInvoices(
  db: D1Database,
  opts: { customerId?: string; branchId?: string }
): Promise<(OpenInvoiceRow & { customerId: string })[]> {
  const conds = ["si.status <> 'VOID'", "si.customer_id IS NOT NULL"];
  const vals: unknown[] = [];
  if (opts.customerId) {
    conds.push("si.customer_id = ?");
    vals.push(opts.customerId);
  }
  if (opts.branchId) {
    conds.push("si.branch_id = ?");
    vals.push(opts.branchId);
  }
  const { results } = await db
    .prepare(
      `SELECT si.id, si.number, si.customer_id, si.branch_id, si.total_cents, ${LOCAL_DATE("si.created_at")} AS d,
              ${TILL_PAID_SQL} AS paid,
              ${RECEIVED_SQL} AS received
       FROM sales_invoices si WHERE ${conds.join(" AND ")}
       ORDER BY d, si.id`
    )
    .bind(...vals)
    .all<{ id: string; number: string; customer_id: string; branch_id: string; total_cents: number; d: string; paid: number; received: number }>();
  return (results ?? [])
    .map((r) => ({
      invoiceId: r.id,
      number: r.number,
      customerId: r.customer_id,
      branchId: r.branch_id,
      date: r.d,
      totalCents: r.total_cents,
      outstandingCents: r.total_cents - r.paid - r.received,
    }))
    .filter((r) => r.outstandingCents > 0);
}

export async function customerOpenInvoices(
  db: D1Database,
  customerId: string,
  branchId?: string
): Promise<{ balanceCents: number | null; invoices: OpenInvoiceRow[] }> {
  const invoices = await openInvoices(db, { customerId, branchId });
  return {
    balanceCents: branchId ? await customerBalance(db, customerId, branchId) : null,
    invoices: invoices.map(({ customerId: _c, ...rest }) => rest),
  };
}

export async function listReceivables(
  db: D1Database,
  opts: { branchId?: string; asOf: string }
): Promise<{ rows: ReceivableRow[]; totalCents: number; aging: ReceivableRow["aging"] }> {
  const bSql = opts.branchId ? " AND e.branch_id = ?" : "";
  const bVals: unknown[] = opts.branchId ? [opts.branchId] : [];
  const { results } = await db
    .prepare(
      `SELECT l.party_id AS customerId, c.name, c.phone, COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS balance
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       LEFT JOIN customers c ON c.id = l.party_id
       WHERE l.account_code = '${RECEIVABLES}' AND l.party_type = 'customer'${bSql}
       GROUP BY l.party_id HAVING balance > 0
       ORDER BY balance DESC`
    )
    .bind(...bVals)
    .all<{ customerId: string; name: string | null; phone: string | null; balance: number }>();
  const invoices = await openInvoices(db, { branchId: opts.branchId });
  const byCustomer = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const list = byCustomer.get(inv.customerId) ?? [];
    list.push(inv);
    byCustomer.set(inv.customerId, list);
  }
  const rows: ReceivableRow[] = (results ?? []).map((r) => {
    const open = byCustomer.get(r.customerId) ?? [];
    return {
      customerId: r.customerId,
      name: r.name ?? r.customerId,
      phone: r.phone,
      balanceCents: r.balance,
      openInvoices: open.length,
      oldestOpenDate: open[0]?.date ?? null,
      aging: agingBuckets(opts.asOf, open.map((i) => ({ id: i.invoiceId, date: i.date, outstandingCents: i.outstandingCents }))),
    };
  });
  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of rows) for (const k of Object.keys(aging) as (keyof typeof aging)[]) aging[k] += r.aging[k];
  return { rows, totalCents: rows.reduce((s, r) => s + r.balanceCents, 0), aging };
}

async function nextReceiptNo(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db
      .prepare("UPDATE counters SET next = next + 1 WHERE name = 'RCPT' RETURNING next - 1 AS allocated")
      .bind()
      .first<{ allocated: number }>();
    if (!row) fail("INTERNAL", "Counter RCPT missing");
    const no = `RCPT-${String(row.allocated).padStart(6, "0")}`;
    const taken = await db.prepare("SELECT 1 AS x FROM customer_receipts WHERE number = ?").bind(no).first();
    if (!taken) return no;
  }
  return fail("INTERNAL", "Counter RCPT is out of step; repair it");
}

/** Where the money lands: the drawer, card clearing, or a named bank account. */
export async function moneyAccount(
  db: D1Database,
  method: "cash" | "bank" | "card",
  bankAccountId?: string
): Promise<{ accountCode: string; bankAccountId: string | null }> {
  if (method === "cash") return { accountCode: CASH, bankAccountId: null };
  if (method === "card") return { accountCode: CARD_CLEARING, bankAccountId: null };
  if (!bankAccountId) fail("VALIDATION", "Choose the bank account the money went into");
  const bank = await db
    .prepare("SELECT account_code, is_active FROM bank_accounts WHERE id = ?")
    .bind(bankAccountId)
    .first<{ account_code: string; is_active: number }>();
  if (!bank) fail("NOT_FOUND", "Bank account not found");
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
  return { accountCode: bank.account_code, bankAccountId };
}

export async function createReceipt(
  db: D1Database,
  input: CustomerReceiptInput,
  actorId: string
): Promise<{ id: string; number: string; entryNo: string; allocations: { invoiceId: string; amountCents: number }[] }> {
  const customer = await db
    .prepare("SELECT id, name FROM customers WHERE id = ?")
    .bind(input.customerId)
    .first<{ id: string; name: string }>();
  if (!customer) fail("NOT_FOUND", "Customer not found");
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) fail("NOT_FOUND", "Branch not found");
  const money = await moneyAccount(db, input.method, input.bankAccountId);
  const cap = await customerBalance(db, input.customerId, input.branchId);
  const open = await openInvoices(db, { customerId: input.customerId, branchId: input.branchId });
  const allocations = allocateReceipt(input.amountCents, open, cap);

  const id = crypto.randomUUID();
  const number = await nextReceiptNo(db);
  const now = Date.now();
  const receiptDate = input.receiptDate ?? (await businessDateFor(db, now));
  const built = await buildEntryStmts(
    db,
    {
      lines: [
        { account: money.accountCode, debitCents: input.amountCents, creditCents: 0 },
        { account: RECEIVABLES, debitCents: 0, creditCents: input.amountCents, partyType: "customer", partyId: customer.id },
      ],
      refEntity: "customer_receipt",
      refId: id,
      refNo: number,
      memo: `Receipt ${number} from ${customer.name}${input.note ? `: ${input.note}` : ""}`,
      branchId: input.branchId,
      actorId,
      auditAction: "receipt.create",
      auditEntity: "customer_receipt",
      auditEntityId: id,
      sourceModule: "receipts",
    },
    { entryDate: receiptDate }
  );
  const stmts: D1PreparedStatement[] = [
    // Header first: the journal entry references nothing here, but the
    // allocations reference the receipt, and D1 enforces FKs per statement.
    db
      .prepare(
        `INSERT INTO customer_receipts (id, number, customer_id, branch_id, receipt_date, amount_cents, method, account_code, bank_account_id, note, status, journal_entry_id, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', NULL, ?, ?)`
      )
      .bind(id, number, customer.id, input.branchId, receiptDate, input.amountCents, input.method, money.accountCode, money.bankAccountId, input.note ?? null, now, actorId),
    ...built.stmts,
    db.prepare("UPDATE customer_receipts SET journal_entry_id = ? WHERE id = ?").bind(built.entryId, id),
  ];
  for (const a of allocations) {
    stmts.push(
      db
        .prepare("INSERT INTO customer_receipt_allocations (id, receipt_id, invoice_id, amount_cents) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, a.invoiceId, a.amountCents)
    );
  }
  for (const a of allocations) stmts.push(settlementStmt(db, a.invoiceId));
  await db.batch(stmts);
  return { id, number, entryNo: built.entryNo, allocations };
}

export async function listReceipts(
  db: D1Database,
  opts: { page: number; limit: number; branchId?: string; customerId?: string; from?: string; to?: string }
): Promise<{ rows: ReceiptRow[]; total: number; totalCents: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.branchId) {
    conds.push("r.branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.customerId) {
    conds.push("r.customer_id = ?");
    vals.push(opts.customerId);
  }
  if (opts.from) {
    conds.push("r.receipt_date >= ?");
    vals.push(opts.from);
  }
  if (opts.to) {
    conds.push("r.receipt_date <= ?");
    vals.push(opts.to);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const stmt = (sql: string, extra: unknown[] = []) => {
    const all = [...vals, ...extra];
    return all.length ? db.prepare(sql).bind(...all) : db.prepare(sql);
  };
  const agg = await stmt(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN r.status = 'POSTED' THEN r.amount_cents ELSE 0 END), 0) AS cents FROM customer_receipts r ${where}`
  ).first<{ total: number; cents: number }>();
  const { results } = await stmt(
    `SELECT r.id, r.number, r.customer_id, COALESCE(c.name, r.customer_id) AS customer_name, r.branch_id, r.receipt_date,
            r.amount_cents, r.method, r.account_code, r.note, r.status, r.void_reason, r.journal_entry_id, r.created_at
     FROM customer_receipts r LEFT JOIN customers c ON c.id = r.customer_id ${where}
     ORDER BY r.receipt_date DESC, r.created_at DESC LIMIT ? OFFSET ?`,
    [opts.limit, (opts.page - 1) * opts.limit]
  ).all<ReceiptRow>();
  return { rows: results ?? [], total: agg?.total ?? 0, totalCents: agg?.cents ?? 0 };
}

export async function getReceipt(
  db: D1Database,
  id: string
): Promise<ReceiptRow & { allocations: { invoice_id: string; number: string; amount_cents: number }[] }> {
  const row = await db
    .prepare(
      `SELECT r.id, r.number, r.customer_id, COALESCE(c.name, r.customer_id) AS customer_name, r.branch_id, r.receipt_date,
              r.amount_cents, r.method, r.account_code, r.note, r.status, r.void_reason, r.journal_entry_id, r.created_at
       FROM customer_receipts r LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`
    )
    .bind(id)
    .first<ReceiptRow>();
  if (!row) fail("NOT_FOUND", "Receipt not found");
  const { results } = await db
    .prepare(
      `SELECT a.invoice_id, si.number, a.amount_cents FROM customer_receipt_allocations a
       JOIN sales_invoices si ON si.id = a.invoice_id WHERE a.receipt_id = ?`
    )
    .bind(id)
    .all<{ invoice_id: string; number: string; amount_cents: number }>();
  return { ...row, allocations: results ?? [] };
}

/**
 * A mistaken receipt is reversed, never deleted: the journal keeps both the
 * receipt and its mirror, and the allocations stop counting because the
 * receipt is VOID. The debt reappears on the customer, which is the point.
 */
export async function voidReceipt(
  db: D1Database,
  id: string,
  reason: string,
  actorId: string
): Promise<{ reversalEntryNo: string }> {
  const receipt = await getReceipt(db, id);
  if (receipt.status !== "POSTED") fail("CONFLICT", "Receipt is already void");
  if (!receipt.journal_entry_id) fail("CONFLICT", "Receipt has no journal entry to reverse");
  const built = await reverseEntry(db, receipt.journal_entry_id, {
    reason: `Void ${receipt.number}: ${reason}`,
    actorId,
    entryDate: await businessDateFor(db, Date.now()),
  });
  await db.batch([
    ...built.stmts,
    db.prepare("UPDATE customer_receipts SET status = 'VOID', void_reason = ? WHERE id = ?").bind(reason, id),
    // The allocations stop counting now the receipt is VOID; the debt is back.
    ...receipt.allocations.map((a) => settlementStmt(db, a.invoice_id)),
    buildAuditStmt(db, {
      userId: actorId,
      action: "receipt.void",
      entity: "customer_receipt",
      entityId: id,
      prev: { status: "POSTED" },
      next: { status: "VOID", reversalEntryNo: built.entryNo },
      reason,
      branchId: receipt.branch_id,
    }),
  ]);
  return { reversalEntryNo: built.entryNo };
}
