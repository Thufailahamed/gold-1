import {
  gToMg,
  lkrToCents,
  type CreateOldGoldInput,
  type TestOldGoldInput,
  type ValueOldGoldInput,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
import { buildCreateProductStmts } from "./products";
import { currentGoldRatesCents } from "./rates";
import { getSetting } from "./settings";

export function valuateOldGold(args: {
  netMg: number;
  permille: number;
  rateCentsPerG: number;
  buyPct: number;
  stoneDeductionCents: number;
  processingDeductionCents: number;
  negotiatedCents?: number;
}): { fineMg: number; grossValueCents: number; valueCents: number } {
  const fineMg = Math.round((args.netMg * args.permille) / 1000);
  const gross = Math.round(((fineMg * args.rateCentsPerG) / 1000) * (args.buyPct / 100));
  const value =
    args.negotiatedCents !== undefined
      ? args.negotiatedCents
      : gross - args.stoneDeductionCents - args.processingDeductionCents;
  if (value <= 0) throw Object.assign(new Error("Value must be positive"), { code: "VALIDATION" });
  return { fineMg, grossValueCents: gross, valueCents: value };
}

const LOCKED = ["RESERVED_FOR_MELTING", "MELTED", "TRANSFERRED"];

function rejectLocked(status: string): void {
  if (LOCKED.includes(status))
    throw Object.assign(new Error("Melting-phase status, locked"), { code: "TRANSITION_LOCKED" });
}

type ItemRow = {
  id: string;
  number: string;
  customer_id: string;
  branch_id: string;
  item_type: string;
  description: string;
  gross_mg: number;
  stone_mg: number;
  net_mg: number;
  purity_id: string | null;
  tested_permille: number | null;
  karat: string | null;
  fine_mg: number;
  rate_cents_per_g: number | null;
  buy_pct: number | null;
  purchase_rate_cents: number | null;
  stone_deduction_cents: number;
  processing_deduction_cents: number;
  negotiated_cents: number | null;
  purchase_value_cents: number | null;
  paid_cents: number;
  status: string;
  converted_product_id: string | null;
  staff_id: string | null;
  notes: string | null;
  image_keys: string;
  doc_keys: string;
  created_at: number;
  created_by: string | null;
};

async function loadItem(db: D1Database, id: string): Promise<ItemRow> {
  const row = await db.prepare("SELECT * FROM old_gold_items WHERE id = ?").bind(id).first<ItemRow>();
  if (!row) throw Object.assign(new Error("Item not found"), { code: "NOT_FOUND" });
  return row;
}

async function nextOG(db: D1Database, stmts: D1PreparedStatement[]): Promise<string> {
  const row = await db
    .prepare("SELECT next FROM counters WHERE name = 'OG'")
    .bind()
    .first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'OG'").bind(row.next + 1));
  return `OG-${String(row.next).padStart(6, "0")}`;
}

async function requireApprover(db: D1Database, approverId: string, actorId: string): Promise<void> {
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
  if (!(results ?? []).some((r) => r.name === "oldgold:approve"))
    throw Object.assign(new Error("Approval requires oldgold:approve"), { code: "FORBIDDEN" });
}

export async function intakeItem(
  db: D1Database,
  input: CreateOldGoldInput,
  actorId: string
): Promise<{ id: string; number: string }> {
  const customer = await db
    .prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1")
    .bind(input.customerId)
    .first();
  if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const grossMg = gToMg(input.grossG);
  const stoneMg = gToMg(input.stoneG);
  const netMg = grossMg - stoneMg;
  if (netMg <= 0)
    throw Object.assign(new Error("Stone weight must be less than gross weight"), {
      code: "VALIDATION",
    });
  const stmts: D1PreparedStatement[] = [];
  const number = await nextOG(db, stmts);
  const id = crypto.randomUUID();
  const now = Date.now();
  stmts.push(
    db
      .prepare(
        "INSERT INTO old_gold_items (id, number, customer_id, branch_id, item_type, description, gross_mg, stone_mg, net_mg, status, staff_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?)"
      )
      .bind(id, number, input.customerId, input.branchId, input.itemType, input.description, grossMg, stoneMg, netMg, actorId, input.notes ?? null, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.intake",
      entity: "old_gold",
      entityId: id,
      next: { number, ...input },
      branchId: input.branchId,
    })
  );
  await db.batch(stmts);
  return { id, number };
}

export async function recordTest(
  db: D1Database,
  itemId: string,
  input: TestOldGoldInput,
  actorId: string
): Promise<{ testId: string }> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  if (item.status !== "RECEIVED" && item.status !== "TESTED")
    throw Object.assign(new Error("Tests allowed in RECEIVED/TESTED only"), { code: "CONFLICT" });
  const { results: prior } = await db
    .prepare("SELECT tested_permille FROM gold_tests WHERE item_id = ?")
    .bind(itemId)
    .all<{ tested_permille: number }>();
  const disagrees = (prior ?? []).some((t) => t.tested_permille !== input.permille);
  if (disagrees) {
    if (!input.approvedBy)
      throw Object.assign(new Error("Disagreement requires approval"), { code: "FORBIDDEN" });
    await requireApprover(db, input.approvedBy, actorId);
  }
  const purity = await db
    .prepare("SELECT id, karat FROM purities WHERE permille = ? AND is_active = 1")
    .bind(input.permille)
    .first<{ id: string; karat: string }>();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO gold_tests (id, item_id, method, tested_permille, tester_id, result, approved_by, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(id, itemId, input.method, input.permille, actorId, input.result, input.approvedBy ?? null, input.notes ?? null, now),
    db
      .prepare("UPDATE old_gold_items SET purity_id = ?, tested_permille = ?, karat = ?, status = 'TESTED' WHERE id = ?")
      .bind(purity?.id ?? null, input.permille, purity?.karat ?? null, itemId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.test",
      entity: "old_gold",
      entityId: itemId,
      next: { method: input.method, permille: input.permille, result: input.result },
      branchId: item.branch_id,
    }),
  ]);
  return { testId: id };
}

export async function valuateItem(
  db: D1Database,
  itemId: string,
  input: ValueOldGoldInput,
  actorId: string
): Promise<{ valueCents: number; fineMg: number }> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  if (item.status !== "TESTED" && item.status !== "VALUED")
    throw Object.assign(new Error("Valuation needs a tested item"), { code: "CONFLICT" });
  if (item.tested_permille === null)
    throw Object.assign(new Error("No tested purity"), { code: "VALIDATION" });

  let rate: number | null = null;
  if (item.purity_id) {
    const rates = await currentGoldRatesCents(db);
    rate = rates.find((r) => r.purity_id === item.purity_id)?.rate_cents_per_g ?? null;
  }
  if (rate === null) {
    const near = await db
      .prepare("SELECT id FROM purities WHERE is_active = 1 ORDER BY ABS(permille - ?) LIMIT 1")
      .bind(item.tested_permille)
      .first<{ id: string }>();
    if (near) {
      const rates = await currentGoldRatesCents(db);
      rate = rates.find((r) => r.purity_id === near.id)?.rate_cents_per_g ?? null;
    }
  }
  if (rate === null)
    throw Object.assign(new Error("No board rate available"), { code: "VALIDATION" });

  let buyPct = input.buyPct;
  let reasonRequired = false;
  if (buyPct === undefined) {
    const s = await getSetting(db, "oldgold_buy_pct");
    buyPct = typeof s?.value === "number" ? s.value : 92;
  } else {
    reasonRequired = true;
  }
  if (input.negotiatedLkr !== undefined) reasonRequired = true;
  if (reasonRequired && !input.reason)
    throw Object.assign(new Error("Reason required for overrides"), { code: "VALIDATION" });

  const stoneDed = lkrToCents(input.stoneDeductionLkr);
  const procDed = lkrToCents(input.processingDeductionLkr);
  const v = valuateOldGold({
    netMg: item.net_mg,
    permille: item.tested_permille,
    rateCentsPerG: rate,
    buyPct,
    stoneDeductionCents: stoneDed,
    processingDeductionCents: procDed,
    negotiatedCents: input.negotiatedLkr !== undefined ? lkrToCents(input.negotiatedLkr) : undefined,
  });
  const purchaseRate = Math.round((v.valueCents / v.fineMg) * 1000);
  await db.batch([
    db
      .prepare(
        "UPDATE old_gold_items SET rate_cents_per_g = ?, buy_pct = ?, purchase_rate_cents = ?, stone_deduction_cents = ?, processing_deduction_cents = ?, negotiated_cents = ?, purchase_value_cents = ?, fine_mg = ?, status = 'VALUED' WHERE id = ?"
      )
      .bind(
        rate,
        buyPct,
        purchaseRate,
        stoneDed,
        procDed,
        input.negotiatedLkr !== undefined ? lkrToCents(input.negotiatedLkr) : null,
        v.valueCents,
        v.fineMg,
        itemId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.value",
      entity: "old_gold",
      entityId: itemId,
      next: { valueCents: v.valueCents, buyPct },
      reason: input.reason,
      branchId: item.branch_id,
    }),
  ]);
  return { valueCents: v.valueCents, fineMg: v.fineMg };
}

export async function purchaseItem(
  db: D1Database,
  itemId: string,
  opts: { paidLkr: number; method: "cash" | "bank" },
  actorId: string
): Promise<{ purchaseId: string }> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  if (item.status !== "VALUED")
    throw Object.assign(new Error("Only valued items can be purchased"), { code: "CONFLICT" });
  if (item.purchase_value_cents === null)
    throw Object.assign(new Error("Item has no valuation"), { code: "VALIDATION" });
  const paidCents = lkrToCents(opts.paidLkr);
  if (paidCents > item.purchase_value_cents)
    throw Object.assign(new Error("Payment exceeds value"), { code: "VALIDATION" });
  const remainder = item.purchase_value_cents - paidCents;
  const cash = opts.method === "cash" ? "1000" : "1010";
  const now = Date.now();
  const purchaseId = crypto.randomUUID();
  const lines = [
    { account: "1100", debitCents: item.purchase_value_cents, creditCents: 0, partyType: "customer" as const, partyId: item.customer_id },
    { account: cash, debitCents: 0, creditCents: paidCents },
  ];
  if (remainder > 0) {
    lines.push({ account: "1200", debitCents: 0, creditCents: remainder, partyType: "customer" as const, partyId: item.customer_id });
  }
  const journal = await buildEntryStmts(
    db,
    {
      lines,
      refEntity: "old_gold_purchase",
      refId: purchaseId,
      refNo: item.number,
      memo: `Old gold ${item.number}`,
      branchId: item.branch_id,
      actorId,
      auditAction: "oldgold.purchase",
      auditEntity: "old_gold",
      auditEntityId: itemId,
      sourceModule: "oldgold",
    },
    { entryDate: await businessDateFor(db, now) }
  );
  await db.batch([
    db
      .prepare("INSERT INTO old_gold_purchases (id, item_id, value_cents, paid_cents, method, journal_entry_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(purchaseId, itemId, item.purchase_value_cents, paidCents, opts.method, journal.entryId, now, actorId),
    db
      .prepare("UPDATE old_gold_items SET paid_cents = ?, status = 'PURCHASED' WHERE id = ?")
      .bind(paidCents, itemId),
    db
      .prepare("INSERT INTO gold_movements (id, product_id, old_gold_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by) VALUES (?, NULL, ?, 'IN', ?, ?, 'old_gold_purchase', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), itemId, item.fine_mg, item.tested_permille ?? 0, purchaseId, item.branch_id, now, actorId),
    ...journal.stmts,
  ]);
  return { purchaseId };
}

export async function releaseItem(db: D1Database, itemId: string, actorId: string): Promise<void> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  if (item.status !== "PURCHASED")
    throw Object.assign(new Error("Only purchased items can be released"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE old_gold_items SET status = 'AVAILABLE' WHERE id = ?").bind(itemId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.release",
      entity: "old_gold",
      entityId: itemId,
      prev: { status: "PURCHASED" },
      next: { status: "AVAILABLE" },
      branchId: item.branch_id,
    }),
  ]);
}

export async function convertItem(
  db: D1Database,
  itemId: string,
  productInput: { categoryId: string; metalTypeId: string; name: string; location?: string },
  actorId: string
): Promise<{ productId: string; barcode: string }> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  if (item.status !== "AVAILABLE")
    throw Object.assign(new Error("Only available items can be converted"), { code: "CONFLICT" });
  if (!item.purity_id)
    throw Object.assign(new Error("Conversion needs a matched purity"), { code: "VALIDATION" });
  if (item.purchase_value_cents === null)
    throw Object.assign(new Error("Item has no purchase value"), { code: "VALIDATION" });
  const now = Date.now();
  const built = await buildCreateProductStmts(
    db,
    {
      name: productInput.name,
      categoryId: productInput.categoryId,
      metalTypeId: productInput.metalTypeId,
      purityId: item.purity_id,
      grossG: item.net_mg / 1000,
      stoneG: 0,
      makingLkr: 0,
      wastageG: 0,
      costLkr: item.purchase_value_cents / 100,
      location: productInput.location,
      notes: `Converted from ${item.number}`,
      branchId: item.branch_id,
    },
    actorId,
    item.branch_id,
    now
  );
  const stmts: D1PreparedStatement[] = [...built.stmts];
  stmts.push(
    db
      .prepare("UPDATE old_gold_items SET converted_product_id = ?, status = 'RESOLD' WHERE id = ?")
      .bind(built.id, itemId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.convert",
      entity: "old_gold",
      entityId: itemId,
      prev: { status: "AVAILABLE" },
      next: { status: "RESOLD", productId: built.id, barcode: built.barcode },
      branchId: item.branch_id,
    })
  );
  await db.batch(stmts);
  return { productId: built.id, barcode: built.barcode };
}

export async function voidItem(
  db: D1Database,
  itemId: string,
  reason: string,
  actorId: string
): Promise<void> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  if (!["RECEIVED", "TESTED", "VALUED"].includes(item.status))
    throw Object.assign(new Error("Only pre-purchase items can be voided"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE old_gold_items SET status = 'VOID' WHERE id = ?").bind(itemId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.void",
      entity: "old_gold",
      entityId: itemId,
      prev: { status: item.status },
      next: { status: "VOID" },
      reason,
      branchId: item.branch_id,
    }),
  ]);
}

export async function addFiles(
  db: D1Database,
  itemId: string,
  kind: "image" | "doc",
  keys: string[],
  actorId: string
): Promise<{ keys: string[] }> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  const col = kind === "image" ? "image_keys" : "doc_keys";
  const current = JSON.parse((kind === "image" ? item.image_keys : item.doc_keys) as string) as string[];
  if (current.length + keys.length > 10)
    throw Object.assign(new Error("Max 10 files per kind"), { code: "VALIDATION" });
  const next = [...current, ...keys];
  await db.batch([
    db.prepare(`UPDATE old_gold_items SET ${col} = ? WHERE id = ?`).bind(JSON.stringify(next), itemId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.files_add",
      entity: "old_gold",
      entityId: itemId,
      next: { kind, keys },
      branchId: item.branch_id,
    }),
  ]);
  return { keys: next };
}

export async function getItem(db: D1Database, id: string) {
  const item = await loadItem(db, id);
  const customer = await db
    .prepare("SELECT id, code, name, phone FROM customers WHERE id = ?")
    .bind(item.customer_id)
    .first();
  const { results: tests } = await db
    .prepare("SELECT * FROM gold_tests WHERE item_id = ? ORDER BY created_at")
    .bind(id)
    .all();
  const purchase = await db
    .prepare("SELECT * FROM old_gold_purchases WHERE item_id = ?")
    .bind(id)
    .first();
  const { results: journal } = await db
    .prepare("SELECT * FROM journal_entries WHERE ref_entity = 'old_gold_purchase' AND ref_id IN (SELECT id FROM old_gold_purchases WHERE item_id = ?) ORDER BY created_at")
    .bind(id)
    .all();
  const { results: gold } = await db
    .prepare("SELECT * FROM gold_movements WHERE old_gold_id = ? ORDER BY created_at")
    .bind(id)
    .all();
  const converted = item.converted_product_id
    ? await db.prepare("SELECT id, barcode, sku, name, status FROM products WHERE id = ?").bind(item.converted_product_id).first()
    : null;
  return {
    item: { ...item, image_keys: JSON.parse(item.image_keys), doc_keys: JSON.parse(item.doc_keys) },
    customer,
    tests: tests ?? [],
    purchase,
    journal: journal ?? [],
    gold: gold ?? [],
    converted,
  };
}

export async function listItems(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: PageOpts & { status?: string; purityId?: string; branchId?: string; customerId?: string; from?: number; to?: number }
) {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(o.number LIKE ? OR o.description LIKE ?)"];
  const vals: unknown[] = [like, like];
  if (opts.status) {
    conds.push("o.status = ?");
    vals.push(opts.status);
  }
  if (opts.purityId) {
    conds.push("o.purity_id = ?");
    vals.push(opts.purityId);
  }
  if (opts.customerId) {
    conds.push("o.customer_id = ?");
    vals.push(opts.customerId);
  }
  if (opts.branchId) {
    conds.push("o.branch_id = ?");
    vals.push(opts.branchId);
  } else if (!canManageAll) {
    conds.push("o.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)");
    vals.push(userId);
  }
  if (opts.from !== undefined) {
    conds.push("o.created_at >= ?");
    vals.push(opts.from);
  }
  if (opts.to !== undefined) {
    conds.push("o.created_at <= ?");
    vals.push(opts.to);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM old_gold_items o ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT o.*, c.name AS customer_name FROM old_gold_items o LEFT JOIN customers c ON c.id = o.customer_id ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, offset)
    .all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function findByBarcode(db: D1Database, code: string) {
  const row = await db
    .prepare("SELECT id FROM old_gold_items WHERE UPPER(number) = UPPER(?)")
    .bind(code.trim())
    .first<{ id: string }>();
  if (!row) throw Object.assign(new Error("Item not found"), { code: "NOT_FOUND" });
  return getItem(db, row.id);
}

export async function oldgoldSummary(db: D1Database, opts: { from: number; to: number; branchId?: string }) {
  const conds = ["o.created_at >= ?", "o.created_at <= ?", "o.status != 'VOID'"];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.branchId) {
    conds.push("o.branch_id = ?");
    vals.push(opts.branchId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const head = await db
    .prepare(`SELECT COUNT(*) AS items, COALESCE(SUM(o.gross_mg), 0) AS gross_mg FROM old_gold_items o ${where}`)
    .bind(...vals)
    .first<{ items: number; gross_mg: number }>();
  const bought = await db
    .prepare(
      `SELECT COALESCE(SUM(o.fine_mg), 0) AS fine_mg, COALESCE(SUM(o.purchase_value_cents), 0) AS value_cents, COALESCE(SUM(o.paid_cents), 0) AS paid_cents FROM old_gold_items o ${where} AND o.status IN ('PURCHASED', 'AVAILABLE', 'RESOLD')`
    )
    .bind(...vals)
    .first<{ fine_mg: number; value_cents: number; paid_cents: number }>();
  return {
    items: head?.items ?? 0,
    gross_mg: head?.gross_mg ?? 0,
    fine_mg: bought?.fine_mg ?? 0,
    value_cents: bought?.value_cents ?? 0,
    paid_cents: bought?.paid_cents ?? 0,
    outstanding_cents: (bought?.value_cents ?? 0) - (bought?.paid_cents ?? 0),
  };
}

export async function oldgoldBreakdown(
  db: D1Database,
  opts: { from: number; to: number; branchId?: string; groupBy: "purity" | "customer" | "branch" }
) {
  const col = opts.groupBy === "purity" ? "COALESCE(o.karat, CAST(o.tested_permille AS TEXT))" : opts.groupBy === "customer" ? "c.name" : "o.branch_id";
  const join = opts.groupBy === "customer" ? "JOIN customers c ON c.id = o.customer_id" : "";
  const bcond = opts.branchId ? "AND o.branch_id = ?" : "";
  const vals: unknown[] = opts.branchId ? [opts.from, opts.to, opts.branchId] : [opts.from, opts.to];
  const { results } = await db
    .prepare(
      `SELECT ${col} AS key, COUNT(*) AS items, COALESCE(SUM(o.purchase_value_cents), 0) AS value_cents, COALESCE(SUM(o.fine_mg), 0) AS fine_mg FROM old_gold_items o ${join} WHERE o.created_at >= ? AND o.created_at <= ? AND o.status IN ('PURCHASED', 'AVAILABLE', 'RESOLD') ${bcond} GROUP BY ${col} ORDER BY value_cents DESC`
    )
    .bind(...vals)
    .all();
  return results ?? [];
}

export async function pendingList(db: D1Database, branchId?: string) {
  const cond = branchId ? "AND o.branch_id = ?" : "";
  const vals = branchId ? [branchId] : [];
  const { results } = await db
    .prepare(
      `SELECT o.id, o.number, o.description, o.fine_mg, o.purchase_value_cents, o.status, o.created_at, c.name AS customer_name FROM old_gold_items o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.status IN ('PURCHASED', 'AVAILABLE') ${cond} ORDER BY o.created_at DESC LIMIT 100`
    )
    .bind(...vals)
    .all();
  return results ?? [];
}

export async function customerOldgold(db: D1Database, customerId: string) {
  const { results: items } = await db
    .prepare("SELECT id, number, description, net_mg, fine_mg, purchase_value_cents, paid_cents, status, created_at FROM old_gold_items WHERE customer_id = ? AND status != 'VOID' ORDER BY created_at DESC")
    .bind(customerId)
    .all();
  const rows = (items ?? []) as { purchase_value_cents: number | null; paid_cents: number }[];
  const value = rows.reduce((s, r) => s + (r.purchase_value_cents ?? 0), 0);
  const paid = rows.reduce((s, r) => s + r.paid_cents, 0);
  return { items: rows, totals: { items: rows.length, value_cents: value, paid_cents: paid, outstanding_cents: value - paid } };
}
