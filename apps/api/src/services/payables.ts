import { agingBuckets } from "@goldos/shared";

const PAYABLES = "2000";
const LOCAL_DATE = (col: string) => `date(${col}/1000,'unixepoch','+330 minutes')`;

type Aging = { "0-30": number; "31-60": number; "61-90": number; "90+": number };

export type PayableRow = {
  supplierId: string;
  name: string;
  phone: string | null;
  balanceCents: number;
  openInvoices: number;
  oldestOpenDate: string | null;
  aging: Aging;
};

export type OpenPurchaseInvoice = {
  invoiceId: string;
  number: string;
  supplierId: string;
  branchId: string;
  date: string;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
};

/**
 * Unpaid purchase invoices: total less what has been paid against them. A
 * voided invoice owes nothing, and neither does one whose receive entry was
 * reversed — the ledger no longer recognises the debt.
 */
async function openPurchaseInvoices(
  db: D1Database,
  opts: { supplierId?: string; branchId?: string }
): Promise<OpenPurchaseInvoice[]> {
  const conds = [
    "pi.status <> 'VOID'",
    `(pi.journal_entry_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM journal_entries je WHERE je.id = pi.journal_entry_id AND je.status = 'REVERSED'))`,
  ];
  const vals: unknown[] = [];
  if (opts.supplierId) {
    conds.push("pi.supplier_id = ?");
    vals.push(opts.supplierId);
  }
  if (opts.branchId) {
    conds.push("pi.branch_id = ?");
    vals.push(opts.branchId);
  }
  const stmt = db.prepare(
    `SELECT pi.id, pi.number, pi.supplier_id, pi.branch_id, pi.total_cents, pi.paid_cents, ${LOCAL_DATE("pi.created_at")} AS d
     FROM purchase_invoices pi WHERE ${conds.join(" AND ")}
     ORDER BY d, pi.id`
  );
  const { results } = await (vals.length ? stmt.bind(...vals) : stmt).all<{
    id: string;
    number: string;
    supplier_id: string;
    branch_id: string;
    total_cents: number;
    paid_cents: number;
    d: string;
  }>();
  return (results ?? [])
    .map((r) => ({
      invoiceId: r.id,
      number: r.number,
      supplierId: r.supplier_id,
      branchId: r.branch_id,
      date: r.d,
      totalCents: r.total_cents,
      paidCents: r.paid_cents,
      outstandingCents: r.total_cents - r.paid_cents,
    }))
    .filter((r) => r.outstandingCents > 0);
}

/**
 * What the shop owes each supplier, from the 2000 control account (credit
 * positive), with the unpaid invoices behind it aged. The balance is the
 * ledger's; the aging is the documents'. They differ only by a supplier
 * opening balance, which has no invoice behind it.
 */
export async function listPayables(
  db: D1Database,
  opts: { branchId?: string; asOf: string }
): Promise<{ rows: PayableRow[]; totalCents: number; aging: Aging }> {
  const bSql = opts.branchId ? " AND e.branch_id = ?" : "";
  const bVals: unknown[] = opts.branchId ? [opts.branchId] : [];
  const stmt = db.prepare(
    `SELECT l.party_id AS supplierId, s.name, s.phone, COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS balance
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     LEFT JOIN suppliers s ON s.id = l.party_id
     WHERE l.account_code = '${PAYABLES}' AND l.party_type = 'supplier'${bSql}
     GROUP BY l.party_id HAVING balance > 0
     ORDER BY balance DESC`
  );
  const { results } = await (bVals.length ? stmt.bind(...bVals) : stmt).all<{
    supplierId: string;
    name: string | null;
    phone: string | null;
    balance: number;
  }>();
  const invoices = await openPurchaseInvoices(db, { branchId: opts.branchId });
  const bySupplier = new Map<string, OpenPurchaseInvoice[]>();
  for (const inv of invoices) {
    const list = bySupplier.get(inv.supplierId) ?? [];
    list.push(inv);
    bySupplier.set(inv.supplierId, list);
  }
  const rows: PayableRow[] = (results ?? []).map((r) => {
    const open = bySupplier.get(r.supplierId) ?? [];
    return {
      supplierId: r.supplierId,
      name: r.name ?? r.supplierId,
      phone: r.phone,
      balanceCents: r.balance,
      openInvoices: open.length,
      oldestOpenDate: open[0]?.date ?? null,
      aging: agingBuckets(opts.asOf, open.map((i) => ({ id: i.invoiceId, date: i.date, outstandingCents: i.outstandingCents }))),
    };
  });
  const aging: Aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of rows) for (const k of Object.keys(aging) as (keyof Aging)[]) aging[k] += r.aging[k];
  return { rows, totalCents: rows.reduce((s, r) => s + r.balanceCents, 0), aging };
}

export async function supplierOpenInvoices(
  db: D1Database,
  supplierId: string,
  branchId?: string
): Promise<{ invoices: OpenPurchaseInvoice[]; totalCents: number }> {
  const invoices = await openPurchaseInvoices(db, { supplierId, branchId });
  return { invoices, totalCents: invoices.reduce((s, i) => s + i.outstandingCents, 0) };
}
