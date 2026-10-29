import { buildAuditStmt } from "../middleware/audit";
import { fail } from "./cashbank";

/**
 * The day sheet: the five-column paper record the counter keeps all day
 * (who / gold weight / received / given / old gold), compared with what the
 * books say happened at the same branch on the same business day.
 *
 * The SYSTEM sheet is never stored. It is derived from posted journal entries
 * every time, so the moment a missing entry is keyed the comparison reflects
 * it. The PAPER sheet's rows are stored exactly as a person confirmed them.
 */

export type Method = "cash" | "bank" | "card" | "cheque" | "credit";
export const METHODS: readonly Method[] = ["cash", "bank", "card", "cheque", "credit"];

export type SheetRow = {
  id: string;
  lineNo: number;
  refNo: string | null;
  name: string | null;
  phone: string | null;
  details: string | null;
  goldText: string | null;
  goldMg: number | null;
  receivedCents: number | null;
  receivedMethod: Method | null;
  givenCents: number | null;
  givenMethod: Method | null;
  oldGoldCents: number | null;
  linkedRef: string | null;
  accepted: boolean;
  acceptNote: string | null;
};

export type SystemRow = {
  /** `${refEntity}:${refId}` — the document the row stands for. */
  ref: string;
  refEntity: string;
  refId: string;
  refNo: string | null;
  kind: string;
  name: string | null;
  phone: string | null;
  customerId: string | null;
  details: string | null;
  goldMg: number | null;
  receivedCents: number;
  givenCents: number;
  oldGoldCents: number;
  /** Put on the customer's account instead of paid (a credit bill). */
  creditCents: number;
  receivedMethods: Method[];
  givenMethods: Method[];
  at: number;
  href: string | null;
};

export type RowIssue = { field: "received" | "given" | "oldGold" | "gold" | "method"; label: string; sheet: string; system: string };

export type RowStatus = "MATCHED" | "MISMATCH" | "MISSING_IN_SYSTEM" | "ACCEPTED" | "EMPTY";

export type RowResult = {
  rowId: string;
  lineNo: number;
  status: RowStatus;
  matchRef: string | null;
  /** How the pairing was made: by hand, or what the matcher leaned on. */
  matchedBy: string[];
  issues: RowIssue[];
};

export type Reconciliation = {
  rows: RowResult[];
  /** In the books that day, on no line of the paper sheet. */
  missingOnSheet: SystemRow[];
  ignored: { ref: string; note: string | null }[];
  totals: {
    sheet: { receivedCents: number; givenCents: number; oldGoldCents: number; goldMg: number };
    system: { receivedCents: number; givenCents: number; oldGoldCents: number; goldMg: number };
  };
  counts: { matched: number; mismatch: number; missingInSystem: number; missingOnSheet: number; accepted: number };
  status: "VERIFIED" | "ISSUES";
};

/* ------------------------------------------------------------ system side */

const CASH = "1000";
const CARD = "1020";
const CREDIT = "1200";

const KIND_LABELS: Record<string, string> = {
  sale_invoice: "Sale",
  sale_return: "Sale return",
  old_gold_purchase: "Old gold bought",
  customer_receipt: "Customer payment",
  repair: "Repair",
  custom_advance: "Order advance",
  custom_advance_refund: "Advance refund",
  purchase_payment: "Supplier payment",
  expense: "Expense",
  owner_capital: "Owner put in",
  owner_drawing: "Owner took",
  staff_advance: "Staff took",
  other_income: "Other income",
  other_expense: "Other expense",
  cash_correction: "Cash correction",
  cash_transfer_in: "Cash transfer in",
  cash_transfer_out: "Cash transfer out",
  cash_deposit: "Bank deposit",
  cash_withdrawal: "Bank withdrawal",
  tax_payment: "Tax paid",
  opening_balance: "Opening balance",
};

const HREFS: Record<string, (id: string) => string> = {
  sale_invoice: (id) => `/sales/invoices/${id}`,
  repair: (id) => `/repairs/${id}`,
  expense: (id) => `/expenses/${id}`,
};

type Line = {
  entry_id: string;
  ref_entity: string | null;
  ref_id: string | null;
  ref_no: string | null;
  entry_no: string;
  memo: string | null;
  created_at: number;
  account_code: string;
  debit_cents: number;
  credit_cents: number;
  party_type: string | null;
  party_id: string | null;
};

type Acc = {
  refEntity: string;
  refId: string;
  refNo: string | null;
  memo: string | null;
  at: number;
  net: Map<string, number>;
  creditCents: number;
  customerId: string | null;
  supplierId: string | null;
};

const all = async <T>(db: D1Database, sql: string, vals: unknown[]): Promise<T[]> =>
  ((await db.prepare(sql).bind(...vals).all<T>()).results ?? []) as T[];

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** Everything the books say happened with money or gold for customers at one branch on one day. */
export async function systemDaySheet(db: D1Database, branchId: string, date: string): Promise<SystemRow[]> {
  const banks = await all<{ account_code: string }>(db, "SELECT account_code FROM bank_accounts", []);
  const methodOf = new Map<string, Method>([[CASH, "cash"], [CARD, "card"]]);
  for (const b of banks) methodOf.set(b.account_code, "bank");

  const lines = await all<Line>(
    db,
    `SELECT e.id AS entry_id, e.ref_entity, e.ref_id, e.ref_no, e.entry_no, e.memo, e.created_at,
            l.account_code, l.debit_cents, l.credit_cents, l.party_type, l.party_id
     FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
     WHERE e.branch_id = ? AND e.entry_date = ?
     ORDER BY e.created_at, e.entry_no`,
    [branchId, date]
  );

  // One accumulator per document. A reversal carries its original's ref, so
  // a voided document nets to nothing and drops out below.
  const docs = new Map<string, Acc>();
  for (const l of lines) {
    const refEntity = l.ref_entity ?? "manual";
    const refId = l.ref_id ?? l.entry_id;
    const key = `${refEntity}:${refId}`;
    let d = docs.get(key);
    if (!d) {
      d = { refEntity, refId, refNo: l.ref_no ?? l.entry_no, memo: l.memo, at: l.created_at, net: new Map(), creditCents: 0, customerId: null, supplierId: null };
      docs.set(key, d);
    }
    const signed = l.debit_cents - l.credit_cents;
    if (methodOf.has(l.account_code)) d.net.set(l.account_code, (d.net.get(l.account_code) ?? 0) + signed);
    if (l.account_code === CREDIT && refEntity === "sale_invoice") d.creditCents += signed;
    if (l.party_type === "customer" && l.party_id) d.customerId = l.party_id;
    if (l.party_type === "supplier" && l.party_id) d.supplierId = l.party_id;
  }

  // Old gold bought that day: its value (and the bill it was traded against).
  const ogpIds = [...docs.values()].filter((d) => d.refEntity === "old_gold_purchase").map((d) => d.refId);
  const ogps = ogpIds.length
    ? await all<{ id: string; value_cents: number; sales_invoice_id: string | null; number: string; description: string; net_mg: number; customer_id: string }>(
        db,
        `SELECT p.id, p.value_cents, p.sales_invoice_id, i.number, i.description, i.net_mg, i.customer_id
         FROM old_gold_purchases p JOIN old_gold_items i ON i.id = p.item_id WHERE p.id IN (${marks(ogpIds.length)})`,
        ogpIds
      )
    : [];
  const ogpById = new Map(ogps.map((o) => [o.id, o]));

  const saleIds = [...docs.values()].filter((d) => d.refEntity === "sale_invoice").map((d) => d.refId);
  const sales = saleIds.length
    ? await all<{ id: string; number: string; customer_id: string | null; status: string; total_cents: number; gold_mg: number; items: string | null; notes: string | null }>(
        db,
        `SELECT si.id, si.number, si.customer_id, si.status, si.total_cents, si.notes,
                COALESCE((SELECT SUM(p.net_mg) FROM sales_items it JOIN products p ON p.id = it.product_id WHERE it.invoice_id = si.id), 0) AS gold_mg,
                (SELECT GROUP_CONCAT(p.name, ', ') FROM sales_items it JOIN products p ON p.id = it.product_id WHERE it.invoice_id = si.id) AS items
         FROM sales_invoices si WHERE si.id IN (${marks(saleIds.length)})`,
        saleIds
      )
    : [];
  const saleById = new Map(sales.map((s) => [s.id, s]));

  const cashIds = [...docs.values()]
    .filter((d) => ["owner_capital", "owner_drawing", "staff_advance", "other_income", "other_expense", "cash_correction"].includes(d.refEntity))
    .map((d) => d.refId);
  const cashRows = cashIds.length
    ? await all<{ id: string; person: string | null; note: string }>(db, `SELECT id, person, note FROM cash_entries WHERE id IN (${marks(cashIds.length)})`, cashIds)
    : [];
  const cashById = new Map(cashRows.map((c) => [c.id, c]));

  const expIds = [...docs.values()].filter((d) => d.refEntity === "expense").map((d) => d.refId);
  const exps = expIds.length
    ? await all<{ id: string; vendor: string | null; description: string }>(db, `SELECT id, vendor, description FROM expenses WHERE id IN (${marks(expIds.length)})`, expIds)
    : [];
  const expById = new Map(exps.map((e) => [e.id, e]));

  const repIds = [...docs.values()].filter((d) => d.refEntity === "repair").map((d) => d.refId);
  const reps = repIds.length
    ? await all<{ id: string; number: string; customer_id: string; item_desc: string; weight_mg: number }>(
        db,
        `SELECT id, number, customer_id, item_desc, weight_mg FROM repairs WHERE id IN (${marks(repIds.length)})`,
        repIds
      )
    : [];
  const repById = new Map(reps.map((r) => [r.id, r]));

  const rows = new Map<string, SystemRow>();
  const customerIds = new Set<string>();
  const supplierIds = new Set<string>();

  for (const [key, d] of docs) {
    let received = 0;
    let given = 0;
    const inM = new Set<Method>();
    const outM = new Set<Method>();
    for (const [acct, cents] of d.net) {
      if (cents > 0) {
        received += cents;
        inM.add(methodOf.get(acct)!);
      } else if (cents < 0) {
        given -= cents;
        outM.add(methodOf.get(acct)!);
      }
    }
    // Money moved between the shop's own accounts (a deposit, a card
    // settlement) is not a customer transaction: it nets to nothing.
    const moneyNet = received - given;
    const sale = d.refEntity === "sale_invoice" ? saleById.get(d.refId) : undefined;
    const ogp = d.refEntity === "old_gold_purchase" ? ogpById.get(d.refId) : undefined;
    if (!sale && !ogp && moneyNet === 0 && d.creditCents === 0) continue;
    if (sale?.status === "VOID" && moneyNet === 0) continue;
    if (d.creditCents > 0) inM.add("credit");

    const row: SystemRow = {
      ref: key,
      refEntity: d.refEntity,
      refId: d.refId,
      refNo: d.refNo,
      kind: KIND_LABELS[d.refEntity] ?? d.refEntity.replace(/_/g, " "),
      name: null,
      phone: null,
      customerId: d.customerId,
      details: d.memo,
      goldMg: null,
      receivedCents: received,
      givenCents: given,
      oldGoldCents: 0,
      creditCents: Math.max(0, d.creditCents),
      receivedMethods: [...inM],
      givenMethods: [...outM],
      at: d.at,
      href: HREFS[d.refEntity]?.(d.refId) ?? null,
    };
    if (sale) {
      row.refNo = sale.number;
      row.customerId = sale.customer_id ?? row.customerId;
      row.goldMg = sale.gold_mg || null;
      row.details = sale.items ? `${sale.items}${sale.notes ? ` · ${sale.notes}` : ""}` : sale.notes;
    } else if (ogp) {
      row.refNo = ogp.number;
      row.customerId = ogp.customer_id;
      row.goldMg = ogp.net_mg || null;
      row.oldGoldCents = ogp.value_cents;
      row.details = ogp.description;
    } else if (cashById.has(d.refId)) {
      const c = cashById.get(d.refId)!;
      row.name = c.person;
      row.details = c.note;
    } else if (expById.has(d.refId)) {
      const e = expById.get(d.refId)!;
      row.name = e.vendor;
      row.details = e.description;
    } else if (repById.has(d.refId)) {
      const r = repById.get(d.refId)!;
      row.refNo = r.number;
      row.customerId = r.customer_id;
      row.goldMg = r.weight_mg || null;
      row.details = r.item_desc;
    }
    if (row.customerId) customerIds.add(row.customerId);
    if (d.supplierId) supplierIds.add(d.supplierId);
    (row as SystemRow & { supplierId?: string | null }).supplierId = d.supplierId;
    rows.set(key, row);
  }

  // An old-for-new exchange is one transaction at the counter: the old gold
  // goes on the same line as the bill it paid towards.
  for (const o of ogps) {
    if (!o.sales_invoice_id) continue;
    const saleRow = rows.get(`sale_invoice:${o.sales_invoice_id}`);
    const ogRow = rows.get(`old_gold_purchase:${o.id}`);
    if (!saleRow || !ogRow) continue;
    saleRow.oldGoldCents += ogRow.oldGoldCents;
    saleRow.receivedCents += ogRow.receivedCents;
    saleRow.givenCents += ogRow.givenCents;
    for (const m of ogRow.givenMethods) if (!saleRow.givenMethods.includes(m)) saleRow.givenMethods.push(m);
    saleRow.details = [saleRow.details, `old gold ${ogRow.refNo}${ogRow.details ? ` (${ogRow.details})` : ""}`].filter(Boolean).join(" · ");
    rows.delete(ogRow.ref);
  }

  if (customerIds.size) {
    const ids = [...customerIds];
    const cs = await all<{ id: string; name: string; phone: string | null }>(db, `SELECT id, name, phone FROM customers WHERE id IN (${marks(ids.length)})`, ids);
    const byId = new Map(cs.map((c) => [c.id, c]));
    for (const r of rows.values()) {
      const c = r.customerId ? byId.get(r.customerId) : undefined;
      if (c) {
        r.name = c.name;
        r.phone = c.phone;
      }
    }
  }
  if (supplierIds.size) {
    const ids = [...supplierIds];
    const ss = await all<{ id: string; name: string; phone: string | null }>(db, `SELECT id, name, phone FROM suppliers WHERE id IN (${marks(ids.length)})`, ids);
    const byId = new Map(ss.map((s) => [s.id, s]));
    for (const r of rows.values()) {
      const sid = (r as SystemRow & { supplierId?: string | null }).supplierId;
      const s = sid ? byId.get(sid) : undefined;
      if (s && !r.name) {
        r.name = s.name;
        r.phone = s.phone;
      }
    }
  }

  return [...rows.values()]
    .map((r) => {
      const { supplierId: _s, ...rest } = r as SystemRow & { supplierId?: string | null };
      return rest as SystemRow;
    })
    .sort((a, b) => a.at - b.at);
}

/* ---------------------------------------------------------------- matcher */

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** "SINV-000481" and "CB-481" both reduce to 481. */
const refKey = (s: string | null | undefined) => digits(s).replace(/^0+/, "");
/** Sri Lankan numbers are written 077…, +94 77…, 94 77… — compare the last nine digits. */
const phoneKey = (s: string | null | undefined) => {
  const d = digits(s);
  return d.length >= 9 ? d.slice(-9) : "";
};
const tokens = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z඀-෿஀-௿ ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

const sameWord = (a: string, b: string) =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a) || editDistance(a, b) <= 1));

/** 0..1: how much of the shorter name appears in the longer one. Handwriting drops and adds letters. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const hits = short.filter((t) => long.some((u) => sameWord(t, u))).length;
  return hits / short.length;
}

const GOLD_TOLERANCE_MG = 20;
const MATCH_THRESHOLD = 40;

function score(row: SheetRow, sys: SystemRow): { score: number; by: string[] } {
  let s = 0;
  const by: string[] = [];
  const rk = refKey(row.refNo);
  if (rk && rk === refKey(sys.refNo)) {
    s += 60;
    by.push("bill no");
  }
  const pk = phoneKey(row.phone) || phoneKey(row.details) || phoneKey(row.name);
  if (pk && pk === phoneKey(sys.phone)) {
    s += 50;
    by.push("phone");
  }
  const nameSim = nameSimilarity(row.name, sys.name);
  // Expenses and drawer takes are written by what they were for ("Wifi
  // adaptor"), which the books keep in the note, not a name.
  const detailSim = Math.max(nameSimilarity(row.name, sys.details), nameSimilarity(row.details, sys.details) * 0.6) * 0.8;
  const sim = Math.max(nameSim, detailSim);
  if (sim > 0) {
    s += Math.round(30 * sim);
    if (nameSim >= 0.5) by.push("name");
    else if (detailSim >= 0.4) by.push("details");
  }
  const rec = row.receivedCents ?? 0;
  const giv = row.givenCents ?? 0;
  const og = row.oldGoldCents ?? 0;
  if (rec > 0 && rec === sys.receivedCents) {
    s += 25;
    by.push("received");
  }
  if (giv > 0 && giv === sys.givenCents) {
    s += 20;
    by.push("given");
  }
  if (og > 0 && og === sys.oldGoldCents) {
    s += 25;
    by.push("old gold");
  }
  if (row.goldMg && sys.goldMg && Math.abs(row.goldMg - sys.goldMg) <= GOLD_TOLERANCE_MG) {
    s += 15;
    by.push("gold weight");
  }
  // A partial payment against the same bill still lines up on the bill total moved.
  const sheetSum = rec + giv + og;
  if (sheetSum > 0 && sheetSum === sys.receivedCents + sys.givenCents + sys.oldGoldCents && !by.some((b) => ["received", "given", "old gold"].includes(b))) {
    s += 10;
    by.push("total");
  }
  // Two rows that only agree on an amount are not the same transaction unless
  // the amount is the only thing either side has.
  if (!by.some((b) => ["bill no", "phone", "name", "details"].includes(b)) && !row.name && !row.refNo) s += 10;
  return { score: s, by };
}

const rs = (c: number | null) => (c === null ? "—" : (c / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const g = (mg: number | null) => (mg === null ? "—" : `${(mg / 1000).toFixed(3)} g`);

function compare(row: SheetRow, sys: SystemRow): RowIssue[] {
  const issues: RowIssue[] = [];
  const pairs: [RowIssue["field"], string, number, number][] = [
    ["received", "Amount received", row.receivedCents ?? 0, sys.receivedCents],
    ["given", "Amount given", row.givenCents ?? 0, sys.givenCents],
    ["oldGold", "Old gold amount", row.oldGoldCents ?? 0, sys.oldGoldCents],
  ];
  for (const [field, label, a, b] of pairs) if (a !== b) issues.push({ field, label, sheet: rs(a), system: rs(b) });
  if (row.goldMg !== null && sys.goldMg !== null && Math.abs(row.goldMg - sys.goldMg) > GOLD_TOLERANCE_MG)
    issues.push({ field: "gold", label: "Gold weight", sheet: g(row.goldMg), system: g(sys.goldMg) });
  if (row.goldMg !== null && row.goldMg > 0 && sys.goldMg === null)
    issues.push({ field: "gold", label: "Gold weight", sheet: g(row.goldMg), system: "no gold recorded" });
  const sheetIn = row.receivedMethod;
  if (sheetIn && sheetIn !== "cash" && (row.receivedCents ?? 0) > 0 && sys.receivedMethods.length && !sys.receivedMethods.includes(sheetIn))
    issues.push({ field: "method", label: "Received by", sheet: sheetIn, system: sys.receivedMethods.join(" + ") });
  const sheetOut = row.givenMethod;
  if (sheetOut && sheetOut !== "cash" && (row.givenCents ?? 0) > 0 && sys.givenMethods.length && !sys.givenMethods.includes(sheetOut))
    issues.push({ field: "method", label: "Given by", sheet: sheetOut, system: sys.givenMethods.join(" + ") });
  return issues;
}

const isEmpty = (r: SheetRow) =>
  !r.refNo && !r.name && !r.phone && !r.details && !r.goldMg && !r.goldText && !r.receivedCents && !r.givenCents && !r.oldGoldCents;

/**
 * Pair every paper row with at most one system document, then say what
 * differs. Pure: everything it needs is passed in, so it is tested directly.
 *
 * Hand-made links win. The rest are paired greedily by score, best first, so
 * a row that matches on bill number takes its document before a row that
 * only matches on an amount can.
 */
export function reconcileSheet(rows: SheetRow[], system: SystemRow[], ignored: { ref: string; note: string | null }[] = []): Reconciliation {
  const sysByRef = new Map(system.map((s) => [s.ref, s]));
  const taken = new Set<string>();
  const pairOf = new Map<string, { sys: SystemRow; by: string[] }>();

  for (const r of rows) {
    if (!r.linkedRef) continue;
    const s = sysByRef.get(r.linkedRef);
    if (s && !taken.has(s.ref)) {
      taken.add(s.ref);
      pairOf.set(r.id, { sys: s, by: ["linked"] });
    }
  }

  const candidates: { rowId: string; sys: SystemRow; score: number; by: string[] }[] = [];
  for (const r of rows) {
    if (pairOf.has(r.id) || isEmpty(r)) continue;
    for (const s of system) {
      if (taken.has(s.ref)) continue;
      const sc = score(r, s);
      if (sc.score >= MATCH_THRESHOLD) candidates.push({ rowId: r.id, sys: s, ...sc });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.sys.at - b.sys.at);
  for (const c of candidates) {
    if (pairOf.has(c.rowId) || taken.has(c.sys.ref)) continue;
    taken.add(c.sys.ref);
    pairOf.set(c.rowId, { sys: c.sys, by: c.by });
  }

  const results: RowResult[] = rows.map((r) => {
    if (isEmpty(r)) return { rowId: r.id, lineNo: r.lineNo, status: "EMPTY", matchRef: null, matchedBy: [], issues: [] };
    const p = pairOf.get(r.id);
    if (!p) return { rowId: r.id, lineNo: r.lineNo, status: r.accepted ? "ACCEPTED" : "MISSING_IN_SYSTEM", matchRef: null, matchedBy: [], issues: [] };
    const issues = compare(r, p.sys);
    const status: RowStatus = issues.length === 0 ? "MATCHED" : r.accepted ? "ACCEPTED" : "MISMATCH";
    return { rowId: r.id, lineNo: r.lineNo, status, matchRef: p.sys.ref, matchedBy: p.by, issues };
  });

  const ignoredRefs = new Set(ignored.map((i) => i.ref));
  const missingOnSheet = system.filter((s) => !taken.has(s.ref) && !ignoredRefs.has(s.ref));

  const sum = (f: (r: SheetRow) => number | null) => rows.reduce((t, r) => t + (f(r) ?? 0), 0);
  const ssum = (f: (r: SystemRow) => number | null) => system.reduce((t, r) => t + (f(r) ?? 0), 0);
  const counts = {
    matched: results.filter((r) => r.status === "MATCHED").length,
    mismatch: results.filter((r) => r.status === "MISMATCH").length,
    missingInSystem: results.filter((r) => r.status === "MISSING_IN_SYSTEM").length,
    missingOnSheet: missingOnSheet.length,
    accepted: results.filter((r) => r.status === "ACCEPTED").length,
  };
  return {
    rows: results,
    missingOnSheet,
    ignored,
    totals: {
      sheet: { receivedCents: sum((r) => r.receivedCents), givenCents: sum((r) => r.givenCents), oldGoldCents: sum((r) => r.oldGoldCents), goldMg: sum((r) => r.goldMg) },
      system: { receivedCents: ssum((r) => r.receivedCents), givenCents: ssum((r) => r.givenCents), oldGoldCents: ssum((r) => r.oldGoldCents), goldMg: ssum((r) => r.goldMg) },
    },
    counts,
    status: counts.mismatch + counts.missingInSystem + counts.missingOnSheet === 0 ? "VERIFIED" : "ISSUES",
  };
}

/* ------------------------------------------------------------ persistence */

export type SheetHeader = {
  id: string;
  branch_id: string;
  sheet_date: string;
  status: "DRAFT" | "VERIFIED" | "ISSUES";
  image_keys: string;
  ai_model: string | null;
  ai_warnings_json: string;
  matched_count: number;
  mismatch_count: number;
  missing_in_system_count: number;
  missing_on_sheet_count: number;
  checked_at: number | null;
  created_at: number;
  updated_at: number;
};

type RowDb = {
  id: string;
  line_no: number;
  ref_no: string | null;
  name: string | null;
  phone: string | null;
  details: string | null;
  gold_text: string | null;
  gold_mg: number | null;
  received_cents: number | null;
  received_method: string | null;
  given_cents: number | null;
  given_method: string | null;
  old_gold_cents: number | null;
  linked_ref: string | null;
  accepted: number;
  accept_note: string | null;
};

const asMethod = (m: string | null): Method | null => (m && (METHODS as readonly string[]).includes(m) ? (m as Method) : null);

const fromDb = (r: RowDb): SheetRow => ({
  id: r.id,
  lineNo: r.line_no,
  refNo: r.ref_no,
  name: r.name,
  phone: r.phone,
  details: r.details,
  goldText: r.gold_text,
  goldMg: r.gold_mg,
  receivedCents: r.received_cents,
  receivedMethod: asMethod(r.received_method),
  givenCents: r.given_cents,
  givenMethod: asMethod(r.given_method),
  oldGoldCents: r.old_gold_cents,
  linkedRef: r.linked_ref,
  accepted: r.accepted === 1,
  acceptNote: r.accept_note,
});

export type SheetRowInput = Partial<Omit<SheetRow, "id" | "lineNo">> & { id?: string };

export type DaySheetView = {
  sheet: (Omit<SheetHeader, "image_keys" | "ai_warnings_json"> & { imageCount: number; warnings: string[] }) | null;
  rows: SheetRow[];
  system: SystemRow[];
  reconciliation: Reconciliation | null;
  dayClosed: boolean;
};

async function loadHeader(db: D1Database, branchId: string, date: string): Promise<SheetHeader | null> {
  return db.prepare("SELECT * FROM day_sheets WHERE branch_id = ? AND sheet_date = ?").bind(branchId, date).first<SheetHeader>();
}

export async function loadHeaderById(db: D1Database, id: string): Promise<SheetHeader> {
  const h = await db.prepare("SELECT * FROM day_sheets WHERE id = ?").bind(id).first<SheetHeader>();
  if (!h) fail("NOT_FOUND", "Day sheet not found");
  return h;
}

async function loadRows(db: D1Database, sheetId: string): Promise<SheetRow[]> {
  return (await all<RowDb>(db, "SELECT * FROM day_sheet_rows WHERE sheet_id = ? ORDER BY line_no", [sheetId])).map(fromDb);
}

async function loadIgnored(db: D1Database, sheetId: string) {
  return all<{ ref: string; note: string | null }>(db, "SELECT ref, note FROM day_sheet_ignores WHERE sheet_id = ? ORDER BY created_at", [sheetId]);
}

const headerView = (h: SheetHeader): NonNullable<DaySheetView["sheet"]> => {
  const { image_keys, ai_warnings_json, ...rest } = h;
  return { ...rest, imageCount: (JSON.parse(image_keys) as string[]).length, warnings: JSON.parse(ai_warnings_json) as string[] };
};

/**
 * Writes the outcome of a check onto the rows and the header, so lists and
 * the sidebar can show open issues without re-deriving every sheet.
 * A DRAFT stays a draft until a person saves it: a half-read photo is not a
 * finding.
 */
async function storeOutcome(db: D1Database, h: SheetHeader, rec: Reconciliation, now: number): Promise<SheetHeader["status"]> {
  const status = h.status === "DRAFT" ? "DRAFT" : rec.status;
  const stmts = rec.rows.map((r) =>
    db.prepare("UPDATE day_sheet_rows SET match_status = ?, match_ref = ?, issues_json = ? WHERE id = ?").bind(r.status, r.matchRef, JSON.stringify(r.issues), r.rowId)
  );
  stmts.push(
    db
      .prepare(
        "UPDATE day_sheets SET status = ?, matched_count = ?, mismatch_count = ?, missing_in_system_count = ?, missing_on_sheet_count = ?, checked_at = ? WHERE id = ?"
      )
      .bind(status, rec.counts.matched, rec.counts.mismatch, rec.counts.missingInSystem, rec.counts.missingOnSheet, now, h.id)
  );
  await db.batch(stmts);
  return status;
}

async function isClosed(db: D1Database, branchId: string, date: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM day_closings WHERE branch_id = ? AND close_date = ? AND status = 'CLOSED'").bind(branchId, date).first());
}

/** The paper sheet for a day (if any), the system's own sheet, and how they compare, checked fresh. */
export async function getDaySheet(db: D1Database, branchId: string, date: string): Promise<DaySheetView> {
  const [h, system, dayClosed] = await Promise.all([loadHeader(db, branchId, date), systemDaySheet(db, branchId, date), isClosed(db, branchId, date)]);
  if (!h) return { sheet: null, rows: [], system, reconciliation: null, dayClosed };
  const [rows, ignored] = await Promise.all([loadRows(db, h.id), loadIgnored(db, h.id)]);
  const rec = reconcileSheet(rows, system, ignored);
  h.status = await storeOutcome(db, h, rec, Date.now());
  h.matched_count = rec.counts.matched;
  h.mismatch_count = rec.counts.mismatch;
  h.missing_in_system_count = rec.counts.missingInSystem;
  h.missing_on_sheet_count = rec.counts.missingOnSheet;
  return { sheet: headerView(h), rows, system, reconciliation: rec, dayClosed };
}

const clean = (s: unknown, max: number): string | null => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function normaliseRows(input: SheetRowInput[]): SheetRow[] {
  return input.map((r, i) => ({
    id: typeof r.id === "string" && r.id ? r.id : crypto.randomUUID(),
    lineNo: i + 1,
    refNo: clean(r.refNo, 40),
    name: clean(r.name, 120),
    phone: clean(r.phone, 30),
    details: clean(r.details, 300),
    goldText: clean(r.goldText, 40),
    goldMg: cents(r.goldMg),
    receivedCents: cents(r.receivedCents),
    receivedMethod: asMethod(r.receivedMethod ?? null),
    givenCents: cents(r.givenCents),
    givenMethod: asMethod(r.givenMethod ?? null),
    oldGoldCents: cents(r.oldGoldCents),
    linkedRef: clean(r.linkedRef, 120),
    accepted: r.accepted === true,
    acceptNote: clean(r.acceptNote, 300),
  }));
}

/**
 * Creates the day's sheet or replaces its rows. `draft` keeps it a DRAFT
 * (fresh from the AI reader); a person's save makes it a checked sheet.
 */
export async function saveDaySheet(
  db: D1Database,
  input: {
    branchId: string;
    date: string;
    rows: SheetRowInput[];
    draft?: boolean;
    imageKeys?: string[];
    /** The new photos replace the old ones instead of adding pages. */
    replaceImages?: boolean;
    aiModel?: string | null;
    warnings?: string[];
  },
  actorId: string
): Promise<DaySheetView> {
  const now = Date.now();
  const rows = normaliseRows(input.rows);
  // Rows keep their ids across saves, so they must belong to this sheet.
  const existing = await loadHeader(db, input.branchId, input.date);
  const id = existing?.id ?? crypto.randomUUID();
  const mine = existing
    ? new Set((await all<{ id: string }>(db, "SELECT id FROM day_sheet_rows WHERE sheet_id = ?", [id])).map((r) => r.id))
    : new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!mine.has(r.id) || seen.has(r.id)) r.id = crypto.randomUUID();
    seen.add(r.id);
  }
  const oldKeys = existing ? (JSON.parse(existing.image_keys) as string[]) : [];
  const keys = input.replaceImages ? (input.imageKeys ?? []) : [...oldKeys, ...(input.imageKeys ?? [])];
  const status = input.draft ? "DRAFT" : "ISSUES";
  const stmts: D1PreparedStatement[] = [];
  if (existing) {
    stmts.push(
      db
        .prepare("UPDATE day_sheets SET status = ?, image_keys = ?, ai_model = COALESCE(?, ai_model), ai_warnings_json = COALESCE(?, ai_warnings_json), updated_at = ?, updated_by = ? WHERE id = ?")
        .bind(status, JSON.stringify(keys), input.aiModel ?? null, input.warnings ? JSON.stringify(input.warnings) : null, now, actorId, id)
    );
  } else {
    stmts.push(
      db
        .prepare(
          "INSERT INTO day_sheets (id, branch_id, sheet_date, status, image_keys, ai_model, ai_warnings_json, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(id, input.branchId, input.date, status, JSON.stringify(keys), input.aiModel ?? null, JSON.stringify(input.warnings ?? []), now, actorId, now, actorId)
    );
  }
  stmts.push(db.prepare("DELETE FROM day_sheet_rows WHERE sheet_id = ?").bind(id));
  for (const r of rows)
    stmts.push(
      db
        .prepare(
          `INSERT INTO day_sheet_rows (id, sheet_id, line_no, ref_no, name, phone, details, gold_text, gold_mg, received_cents, received_method, given_cents, given_method, old_gold_cents, linked_ref, accepted, accept_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(r.id, id, r.lineNo, r.refNo, r.name, r.phone, r.details, r.goldText, r.goldMg, r.receivedCents, r.receivedMethod, r.givenCents, r.givenMethod, r.oldGoldCents, r.linkedRef, r.accepted ? 1 : 0, r.acceptNote)
    );
  stmts.push(
    buildAuditStmt(db, {
      userId: actorId,
      action: input.draft ? "daysheet.read" : "daysheet.save",
      entity: "day_sheet",
      entityId: id,
      next: { date: input.date, rows: rows.length },
      branchId: input.branchId,
    })
  );
  await db.batch(stmts);
  return getDaySheet(db, input.branchId, input.date);
}

/** Pairs one paper row with a system document by hand (or clears the pairing). */
export async function linkRow(db: D1Database, sheetId: string, rowId: string, ref: string | null, actorId: string): Promise<void> {
  const h = await loadHeaderById(db, sheetId);
  const row = await db.prepare("SELECT id FROM day_sheet_rows WHERE id = ? AND sheet_id = ?").bind(rowId, sheetId).first();
  if (!row) fail("NOT_FOUND", "That line is not on this sheet");
  await db.batch([
    db.prepare("UPDATE day_sheet_rows SET linked_ref = ? WHERE id = ?").bind(ref, rowId),
    db.prepare("UPDATE day_sheets SET updated_at = ?, updated_by = ? WHERE id = ?").bind(Date.now(), actorId, sheetId),
    buildAuditStmt(db, { userId: actorId, action: "daysheet.link", entity: "day_sheet", entityId: sheetId, next: { rowId, ref }, branchId: h.branch_id }),
  ]);
}

/** Accepts (or un-accepts) a difference on one line, with the reason. */
export async function acceptRow(db: D1Database, sheetId: string, rowId: string, accepted: boolean, note: string | null, actorId: string): Promise<void> {
  const h = await loadHeaderById(db, sheetId);
  if (accepted && !note?.trim()) fail("VALIDATION", "Say why the difference is accepted");
  const row = await db.prepare("SELECT id FROM day_sheet_rows WHERE id = ? AND sheet_id = ?").bind(rowId, sheetId).first();
  if (!row) fail("NOT_FOUND", "That line is not on this sheet");
  await db.batch([
    db.prepare("UPDATE day_sheet_rows SET accepted = ?, accept_note = ? WHERE id = ?").bind(accepted ? 1 : 0, accepted ? note!.trim() : null, rowId),
    buildAuditStmt(db, { userId: actorId, action: "daysheet.accept", entity: "day_sheet", entityId: sheetId, next: { rowId, accepted, note }, branchId: h.branch_id }),
  ]);
}

/** Marks a system document as one that never goes on the paper sheet (or puts it back). */
export async function ignoreSystemRow(db: D1Database, sheetId: string, ref: string, ignore: boolean, note: string | null, actorId: string): Promise<void> {
  const h = await loadHeaderById(db, sheetId);
  if (ignore && !note?.trim()) fail("VALIDATION", "Say why this is not on the paper sheet");
  await db.batch([
    ignore
      ? db
          .prepare("INSERT INTO day_sheet_ignores (sheet_id, ref, note, created_at, created_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sheet_id, ref) DO UPDATE SET note = excluded.note")
          .bind(sheetId, ref, note!.trim(), Date.now(), actorId)
      : db.prepare("DELETE FROM day_sheet_ignores WHERE sheet_id = ? AND ref = ?").bind(sheetId, ref),
    buildAuditStmt(db, { userId: actorId, action: "daysheet.ignore", entity: "day_sheet", entityId: sheetId, next: { ref, ignore, note }, branchId: h.branch_id }),
  ]);
}

/** Adds a system document as a new line on the paper sheet (it was written on paper but the reader missed it, or the person forgot). */
export async function appendSystemRow(db: D1Database, sheetId: string, ref: string, actorId: string): Promise<void> {
  const h = await loadHeaderById(db, sheetId);
  const sys = (await systemDaySheet(db, h.branch_id, h.sheet_date)).find((s) => s.ref === ref);
  if (!sys) fail("NOT_FOUND", "That transaction is not in the books for this day");
  const max = await db.prepare("SELECT COALESCE(MAX(line_no), 0) AS n FROM day_sheet_rows WHERE sheet_id = ?").bind(sheetId).first<{ n: number }>();
  const method = (ms: Method[]) => (ms.length === 1 ? ms[0]! : ms.includes("bank") ? "bank" : ms.includes("card") ? "card" : null);
  await db.batch([
    db
      .prepare(
        `INSERT INTO day_sheet_rows (id, sheet_id, line_no, ref_no, name, phone, details, gold_mg, received_cents, received_method, given_cents, given_method, old_gold_cents, linked_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        sheetId,
        (max?.n ?? 0) + 1,
        sys.refNo,
        sys.name,
        sys.phone,
        sys.details,
        sys.goldMg,
        sys.receivedCents || null,
        sys.receivedCents ? method(sys.receivedMethods.filter((m) => m !== "credit")) : null,
        sys.givenCents || null,
        sys.givenCents ? method(sys.givenMethods) : null,
        sys.oldGoldCents || null,
        sys.ref
      ),
    buildAuditStmt(db, { userId: actorId, action: "daysheet.append", entity: "day_sheet", entityId: sheetId, next: { ref }, branchId: h.branch_id }),
  ]);
}

export async function listDaySheets(
  db: D1Database,
  opts: { branchIds: string[] | null; branchId?: string; from: string; to: string; status?: string }
): Promise<(Omit<SheetHeader, "image_keys" | "ai_warnings_json"> & { imageCount: number; warnings: string[]; rows: number })[]> {
  const where = ["sheet_date BETWEEN ? AND ?"];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.branchId) {
    where.push("branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.branchIds) {
    if (!opts.branchIds.length) return [];
    where.push(`branch_id IN (${marks(opts.branchIds.length)})`);
    vals.push(...opts.branchIds);
  }
  if (opts.status) {
    where.push("status = ?");
    vals.push(opts.status);
  }
  const rows = await all<SheetHeader & { rows: number }>(
    db,
    `SELECT s.*, (SELECT COUNT(*) FROM day_sheet_rows r WHERE r.sheet_id = s.id) AS rows FROM day_sheets s WHERE ${where.join(" AND ")} ORDER BY sheet_date DESC, branch_id LIMIT 200`,
    vals
  );
  return rows.map((r) => ({ ...headerView(r), rows: r.rows }));
}

/** Sheets with open issues, for the sidebar badge and the day-close survey. */
export async function openIssueCount(db: D1Database, branchIds: string[] | null): Promise<number> {
  if (branchIds && !branchIds.length) return 0;
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM day_sheets WHERE status = 'ISSUES'${branchIds ? ` AND branch_id IN (${marks(branchIds.length)})` : ""}`)
    .bind(...(branchIds ?? []))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function sheetImage(db: D1Database, r2: Pick<R2Bucket, "get">, sheetId: string, index: number): Promise<{ body: ArrayBuffer; contentType: string }> {
  const h = await loadHeaderById(db, sheetId);
  const key = (JSON.parse(h.image_keys) as string[])[index];
  if (!key) fail("NOT_FOUND", "No photo with that number");
  const obj = await r2.get(key);
  if (!obj) fail("NOT_FOUND", "Photo file not found");
  return { body: await obj.arrayBuffer(), contentType: obj.httpMetadata?.contentType ?? "image/jpeg" };
}
