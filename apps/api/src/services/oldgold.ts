import {
  gToMg,
  lkrToCents,
  SHOP_STOCK_CUSTOMER_ID,
  type BuyInOldGoldInput,
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
import { consumeApproval, pendingApproval, requestApproval } from "./approvals";
import { postGoldStmts } from "./gold";
import { creditToOpenBills } from "./receipts";
import { allocateNumber } from "./counters";
import { batchOrConflict, staleGuard } from "./guard";

/**
 * Board rates are quoted per gram of the purity they belong to (a 22K rate is
 * the price of a gram of 22K metal — sales price net weight × that rate). So
 * the item's fine gold is converted back to metal of the rate's purity before
 * the rate applies: value = fine × rate × 1000 / ratePermille. Multiplying
 * fine grams by a karat rate directly discounts the purity twice (a 22K piece
 * at "92%" came out at ~84% of its board value; an 18K piece far worse).
 */
export function valuateOldGold(args: {
  netMg: number;
  permille: number;
  rateCentsPerG: number;
  /** Permille of the purity the board rate is quoted for. */
  ratePermille: number;
  buyPct: number;
  stoneDeductionCents: number;
  processingDeductionCents: number;
  negotiatedCents?: number;
}): { fineMg: number; grossValueCents: number; valueCents: number } {
  if (args.ratePermille <= 0 || args.ratePermille > 1000)
    throw Object.assign(new Error("Invalid rate purity"), { code: "VALIDATION" });
  const fineMg = Math.round((args.netMg * args.permille) / 1000);
  if (fineMg <= 0) throw Object.assign(new Error("Item has no fine gold"), { code: "VALIDATION" });
  const gross = Math.round(
    ((args.netMg * args.permille * args.rateCentsPerG) / (args.ratePermille * 1000)) * (args.buyPct / 100)
  );
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
  /** Null for the shop's own stock, which has no seller. */
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

export async function nextOG(db: D1Database): Promise<string> {
  return allocateNumber(db, "OG", "OG", 6, "old_gold_items");
}

/**
 * A status change guarded on the status the caller read, followed by the
 * stale guard: when two requests race, the loser changes no row and its whole
 * batch (journal, gold ledger, audit) rolls back instead of posting twice.
 */
function moveStmts(db: D1Database, itemId: string, from: string[], set: string, binds: unknown[]): D1PreparedStatement[] {
  return [
    db
      .prepare(`UPDATE old_gold_items SET ${set} WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`)
      .bind(...binds, itemId, ...from),
    staleGuard(db),
  ];
}

const RACED = "Item changed while saving; reload and try again";


/**
 * The rows that take a piece of old gold in: the item (received, not yet
 * tested) and its intake audit. Shared by the intake desk and the till, so a
 * piece taken in at the POS is recorded exactly like one taken in at the desk.
 */
/** The old gold categories (named OLD GOLD …), and the default one, code OG. */
export async function oldGoldCategories(db: D1Database): Promise<{ id: string; name: string; code: string; isDefault: boolean }[]> {
  const { results } = await db
    .prepare("SELECT id, name, code FROM categories WHERE is_active = 1 AND name LIKE 'OLD GOLD%' ORDER BY name COLLATE NOCASE")
    .all<{ id: string; name: string; code: string }>();
  return (results ?? []).map((c) => ({ ...c, isDefault: c.code.toUpperCase() === "OG" }));
}

const DEFAULT_OG_CATEGORY_ID = "cat-oldgold-og";

/**
 * The shop's default old gold category, when it has none. Returns the category
 * and the statement that creates it; null when the code OG is already in use by
 * another category, which is left to the shop to sort out.
 */
async function defaultOldGoldCategory(
  db: D1Database
): Promise<{ id: string; name: string; code: string; isDefault: boolean; insert: D1PreparedStatement } | null> {
  const taken = await db.prepare("SELECT 1 AS x FROM categories WHERE code = 'OG'").first();
  if (taken) return null;
  return {
    id: DEFAULT_OG_CATEGORY_ID,
    name: "OLD GOLD OG",
    code: "OG",
    isDefault: true,
    insert: db
      .prepare("INSERT OR IGNORE INTO categories (id, name, code, is_active, created_at) VALUES (?, 'OLD GOLD OG', 'OG', 1, ?)")
      .bind(DEFAULT_OG_CATEGORY_ID, Date.now()),
  };
}

/**
 * `alreadyInStock`: the metal and its cost were booked by another save in the
 * same batch (a product intake), so this record only tracks the piece and posts
 * no gold or journal of its own. Posting again would count the metal twice.
 */
export async function intakeStatements(
  db: D1Database,
  input: CreateOldGoldInput,
  actorId: string,
  opts: { alreadyInStock?: boolean } = {}
): Promise<{ id: string; number: string; stmts: D1PreparedStatement[] }> {
  const shopOwned = input.shopOwned === true;
  if (shopOwned) {
    // The shop's own stock is valued at cost and goes straight to the shelf: no seller, no testing queue.
    if (input.needsTesting) throw Object.assign(new Error("Shop-owned stock needs its karat, not testing"), { code: "VALIDATION" });
  } else {
    if (!input.customerId) throw Object.assign(new Error("Pick the customer, or tick Shop-owned stock"), { code: "VALIDATION" });
    const customer = await db
      .prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1")
      .bind(input.customerId)
      .first();
    if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  }
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
  // The category: the one chosen, else the OG category. It must be an old gold category.
  const categories = await oldGoldCategories(db);
  // A shop that never set up an old gold category gets the default one, OLD GOLD OG, on its first intake.
  // The id is fixed and the insert ignores a repeat, so several pieces saved in one batch share it.
  const defaultCategory = !input.categoryId && categories.length === 0 ? await defaultOldGoldCategory(db) : null;
  const category = input.categoryId
    ? categories.find((c) => c.id === input.categoryId)
    : (categories.find((c) => c.isDefault) ?? defaultCategory);
  if (!category)
    throw Object.assign(new Error(input.categoryId ? "Pick one of the old gold categories" : "No OG old gold category is set up"), {
      code: "VALIDATION",
    });
  // With a karat and no testing, the piece is Tested at once. With testing, or with no karat yet, it waits in the testing queue.
  let purity: { id: string; permille: number; karat: string } | null = null;
  if (!input.needsTesting && input.purityId) {
    purity = await db
      .prepare("SELECT id, permille, karat FROM purities WHERE id = ? AND is_active = 1")
      .bind(input.purityId)
      .first<{ id: string; permille: number; karat: string }>();
    if (!purity) throw Object.assign(new Error("Karat not found"), { code: "NOT_FOUND" });
  }
  const number = await nextOG(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  // Shop-owned stock is owned already, so it is AVAILABLE with its fine gold and book cost set.
  const fineMg = shopOwned && purity ? Math.round((netMg * purity.permille) / 1000) : 0;
  const costCents = shopOwned && input.costLkr !== undefined ? lkrToCents(input.costLkr) : null;
  // The shop's own stock belongs to a built-in customer (inactive, so never offered at the counter), created on first use.
  const sentinel = shopOwned
    ? [
        db
          .prepare("INSERT OR IGNORE INTO customers (id, code, name, is_active, branch_id, created_at) VALUES (?, 'SHOP-STOCK', 'Shop stock', 0, ?, 0)")
          .bind(SHOP_STOCK_CUSTOMER_ID, input.branchId),
      ]
    : [];
  const stmts: D1PreparedStatement[] = [
    ...(defaultCategory ? [defaultCategory.insert] : []),
    ...sentinel,
    db
      .prepare(
        "INSERT INTO old_gold_items (id, number, customer_id, branch_id, item_type, description, gross_mg, stone_mg, net_mg, status, staff_id, notes, created_at, created_by, purity_id, tested_permille, karat, fine_mg, purchase_value_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id,
        number,
        shopOwned ? SHOP_STOCK_CUSTOMER_ID : input.customerId,
        input.branchId,
        input.itemType?.trim() || "Old gold",
        input.description?.trim() || (shopOwned ? `Shop stock, ${input.grossG} g` : `Old gold, ${input.grossG} g`),
        grossMg,
        stoneMg,
        netMg,
        shopOwned ? "AVAILABLE" : purity ? "TESTED" : "RECEIVED",
        actorId,
        input.notes ?? null,
        now,
        actorId,
        purity?.id ?? null,
        purity?.permille ?? null,
        purity?.karat ?? null,
        fineMg,
        costCents
      ),
    db
      .prepare("INSERT INTO old_gold_item_categories (item_id, category_id) VALUES (?, ?)")
      .bind(id, category.id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.intake",
      entity: "old_gold",
      entityId: id,
      next: { number, ...input, categoryId: category.id },
      branchId: input.branchId,
    }),
  ];
  if (shopOwned && !opts.alreadyInStock && purity && costCents !== null) {
    // The metal enters branch stock as opening stock (no seller owed, no cash moved),
    // booked at cost against 3100 Opening Balances, as a direct product intake is.
    const journal = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "1100", debitCents: costCents, creditCents: 0 },
          { account: "3100", debitCents: 0, creditCents: costCents },
        ],
        refEntity: "old_gold_shop",
        refId: id,
        refNo: number,
        memo: `Shop-owned old gold ${number}`,
        branchId: input.branchId,
        actorId,
        auditAction: "oldgold.shop_intake",
        auditEntity: "old_gold",
        auditEntityId: id,
        sourceModule: "oldgold",
      },
      { entryDate: await businessDateFor(db, now) }
    );
    stmts.push(
      db
        .prepare("INSERT INTO gold_movements (id, product_id, old_gold_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by) VALUES (?, NULL, ?, 'IN', ?, ?, 'old_gold_shop', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), id, fineMg, purity.permille, id, input.branchId, now, actorId),
      ...(await postGoldStmts(
        db,
        [
          {
            branchId: input.branchId,
            source: "opening",
            destination: `branch:${input.branchId}`,
            type: "OPENING",
            weightMg: netMg,
            permille: purity.permille,
            refEntity: "old_gold_shop",
            refId: id,
            oldGoldId: id,
            notes: `Shop-owned old gold ${number}`,
          },
        ],
        { actorId, auditAction: "oldgold.shop_intake.gold", auditEntity: "old_gold", auditEntityId: id, branchId: input.branchId }
      )),
      ...journal.stmts
    );
  }
  return { id, number, stmts };
}

/**
 * A piece bought from a customer and put straight into stock, in one request:
 * taken in at its karat and price per gram, valued at that price, paid for, and
 * released to stock. There is no testing step. If the buy cannot finish, the
 * intake is voided and nothing stays on record. A piece already paid for is kept,
 * and is released from its item page.
 */
export async function buyInItem(
  db: D1Database,
  input: BuyInOldGoldInput,
  actorId: string
): Promise<{ id: string; number: string; valueCents: number }> {
  const item = await intakeItem(db, { ...input, needsTesting: false }, actorId);
  try {
    const v = await valuateItem(db, item.id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, actorId);
    await purchaseItem(db, item.id, { paidLkr: input.paidLkr ?? v.valueCents / 100, method: input.method }, actorId);
    await releaseItem(db, item.id, actorId);
    return { ...item, valueCents: v.valueCents };
  } catch (err) {
    await voidItem(db, item.id, "Buy-in did not finish", actorId).catch(() => {});
    throw err;
  }
}

export async function intakeItem(
  db: D1Database,
  input: CreateOldGoldInput,
  actorId: string
): Promise<{ id: string; number: string }> {
  const built = await intakeStatements(db, input, actorId);
  const stmts = [...built.stmts];
  if (input.quotedRateLkr !== undefined)
    stmts.push(
      db
        .prepare("INSERT INTO old_gold_quotes (item_id, rate_cents_per_g, created_at) VALUES (?, ?, ?)")
        .bind(built.id, lkrToCents(input.quotedRateLkr), Date.now())
    );
  await db.batch(stmts);
  return { id: built.id, number: built.number };
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
  // approved_by is a foreign key: an unknown id used to surface as a raw 500.
  if (input.approvedBy !== undefined) {
    if (input.approvedBy === actorId)
      throw Object.assign(new Error("Approver cannot be yourself"), { code: "FORBIDDEN" });
    const approver = await db
      .prepare("SELECT id FROM users WHERE id = ? AND is_active = 1")
      .bind(input.approvedBy)
      .first();
    if (!approver) throw Object.assign(new Error("Approver not found"), { code: "NOT_FOUND" });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  // Only a passing test sets the purity the item is valued and bought at. A
  // failed or inconclusive reading is kept on the record but sends the item
  // back to RECEIVED, so it cannot be valued on a purity nobody vouched for.
  let move: D1PreparedStatement[];
  if (input.result === "pass") {
    const purity = await db
      .prepare("SELECT id, karat FROM purities WHERE permille = ? AND is_active = 1")
      .bind(input.permille)
      .first<{ id: string; karat: string }>();
    move = moveStmts(db, itemId, [item.status], "purity_id = ?, tested_permille = ?, karat = ?, status = 'TESTED'", [
      purity?.id ?? null,
      input.permille,
      purity?.karat ?? null,
    ]);
  } else {
    move = moveStmts(db, itemId, [item.status], "purity_id = NULL, tested_permille = NULL, karat = NULL, status = 'RECEIVED'", []);
  }
  await batchOrConflict(db, [
    ...move,
    db
      .prepare(
        "INSERT INTO gold_tests (id, item_id, method, tested_permille, tester_id, result, approved_by, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(id, itemId, input.method, input.permille, actorId, input.result, input.approvedBy ?? null, input.notes ?? null, now),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.test",
      entity: "old_gold",
      entityId: itemId,
      next: { method: input.method, permille: input.permille, result: input.result },
      branchId: item.branch_id,
    }),
  ], RACED);
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

  // The item's own purity when it has a board rate, otherwise the closest
  // purity that HAS one. (Picking the closest purity first and then looking
  // for its rate failed whenever that purity had no rate posted.)
  const rates = await currentGoldRatesCents(db);
  const { results: purityRows } = await db
    .prepare("SELECT id, permille FROM purities WHERE is_active = 1")
    .all<{ id: string; permille: number }>();
  const permilleOf = new Map((purityRows ?? []).map((p) => [p.id, p.permille]));
  const rated = rates
    .filter((r) => r.rate_cents_per_g > 0 && permilleOf.has(r.purity_id))
    .map((r) => ({ rate: r.rate_cents_per_g, permille: permilleOf.get(r.purity_id)!, purityId: r.purity_id }));
  const tested = item.tested_permille;
  const board =
    rated.find((r) => r.purityId === item.purity_id) ??
    rated.sort((a, b) => Math.abs(a.permille - tested) - Math.abs(b.permille - tested))[0];
  if (!board)
    throw Object.assign(new Error("No board rate available"), { code: "VALIDATION" });
  const rate = board.rate;

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
  // Valuation overrides (custom buy % or negotiated total) go through the
  // unified engine. Standard valuations skip it entirely. Metric is 1 — any
  // override requires approval unless disabled; terms bind via the item id.
  if (reasonRequired) {
    if (input.approvalId) {
      await consumeApproval(
        db,
        { action: "OLDGOLD_VALUATION", id: input.approvalId, entity: "old_gold", entityId: itemId, metric: 1 },
        actorId
      );
    } else {
      const req = await requestApproval(
        db,
        {
          action: "OLDGOLD_VALUATION",
          entity: "old_gold",
          entityId: itemId,
          oldValue: {},
          newValue: { buyPct, negotiatedLkr: input.negotiatedLkr ?? null },
          metric: 1,
          reason: input.reason as string,
          branchId: item.branch_id,
        },
        actorId
      );
      if (req.status === "PENDING") pendingApproval(req, "OLDGOLD_VALUATION");
    }
  }

  const stoneDed = lkrToCents(input.stoneDeductionLkr);
  const procDed = lkrToCents(input.processingDeductionLkr);
  // A price typed at intake (net × price per gram) is the value, unless the
  // valuation overrides the buy % or the negotiated total. Deductions still come off it.
  const quote = await db
    .prepare("SELECT rate_cents_per_g FROM old_gold_quotes WHERE item_id = ?")
    .bind(itemId)
    .first<{ rate_cents_per_g: number }>();
  const quotedCents = quote ? Math.round((item.net_mg / 1000) * quote.rate_cents_per_g) : null;
  const noOverride = input.buyPct === undefined && input.negotiatedLkr === undefined;
  const negotiated =
    input.negotiatedLkr !== undefined
      ? lkrToCents(input.negotiatedLkr)
      : noOverride && quotedCents !== null
        ? quotedCents - stoneDed - procDed
        : undefined;
  const v = valuateOldGold({
    netMg: item.net_mg,
    permille: item.tested_permille,
    rateCentsPerG: rate,
    ratePermille: board.permille,
    buyPct,
    stoneDeductionCents: stoneDed,
    processingDeductionCents: procDed,
    negotiatedCents: negotiated,
  });
  // Price actually paid per gram of fine gold.
  const purchaseRate = Math.round((v.valueCents / v.fineMg) * 1000);
  await batchOrConflict(db, [
    ...moveStmts(
      db,
      itemId,
      [item.status],
      "rate_cents_per_g = ?, buy_pct = ?, purchase_rate_cents = ?, stone_deduction_cents = ?, processing_deduction_cents = ?, negotiated_cents = ?, purchase_value_cents = ?, fine_mg = ?, status = 'VALUED'",
      [
        rate,
        buyPct,
        purchaseRate,
        stoneDed,
        procDed,
        negotiated ?? null,
        v.valueCents,
        v.fineMg,
      ]
    ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.value",
      entity: "old_gold",
      entityId: itemId,
      next: { valueCents: v.valueCents, buyPct, rateCentsPerG: rate, ratePermille: board.permille },
      reason: input.reason,
      branchId: item.branch_id,
    }),
  ], RACED);
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
  if (item.customer_id === SHOP_STOCK_CUSTOMER_ID)
    throw Object.assign(new Error("Shop-owned stock has no seller to buy from"), { code: "CONFLICT" });
  if (item.status !== "VALUED")
    throw Object.assign(new Error("Only valued items can be purchased"), { code: "CONFLICT" });
  if (item.purchase_value_cents === null)
    throw Object.assign(new Error("Item has no valuation"), { code: "VALIDATION" });
  // The live gold ledger (not just legacy gold_movements below) must record
  // every purchased gram, or gold_stock_consistency and the OLD_GOLD_PURCHASE
  // cross-foot fail by exactly this weight until the item melts.
  if (item.tested_permille === null || item.tested_permille <= 0 || item.tested_permille > 1000)
    throw Object.assign(new Error("Item has no tested purity"), { code: "VALIDATION" });
  if (item.net_mg <= 0)
    throw Object.assign(new Error("Item has no net weight"), { code: "VALIDATION" });
  const paidCents = lkrToCents(opts.paidLkr);
  if (paidCents > item.purchase_value_cents)
    throw Object.assign(new Error("Payment exceeds value"), { code: "VALIDATION" });
  const remainder = item.purchase_value_cents - paidCents;
  const cash = opts.method === "cash" ? "1000" : "1010";
  const now = Date.now();
  const purchaseId = crypto.randomUUID();
  const lines: { account: string; debitCents: number; creditCents: number; partyType?: "customer"; partyId?: string }[] = [
    { account: "1100", debitCents: item.purchase_value_cents, creditCents: 0, partyType: "customer" as const, partyId: item.customer_id },
  ];
  // A zero cash line is rejected by the journal ("debit XOR credit"), which
  // made an all-on-credit purchase (paid 0) impossible.
  if (paidCents > 0) lines.push({ account: cash, debitCents: 0, creditCents: paidCents });
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
  // Whatever is not paid in cash is credit for the customer: it settles their open bills, oldest first.
  const credit = await creditToOpenBills(db, item.customer_id, remainder);
  await batchOrConflict(db, [
    // Guarded on VALUED and on the value the customer was quoted, so a racing
    // second purchase (or a re-valuation that landed in between) rolls back.
    db
      .prepare("UPDATE old_gold_items SET paid_cents = ?, status = 'PURCHASED' WHERE id = ? AND status = 'VALUED' AND purchase_value_cents = ?")
      .bind(paidCents, itemId, item.purchase_value_cents),
    staleGuard(db),
    db
      .prepare("INSERT INTO old_gold_purchases (id, item_id, value_cents, paid_cents, method, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(purchaseId, itemId, item.purchase_value_cents, paidCents, opts.method, now, actorId),
    db
      .prepare("INSERT INTO gold_movements (id, product_id, old_gold_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by) VALUES (?, NULL, ?, 'IN', ?, ?, 'old_gold_purchase', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), itemId, item.fine_mg, item.tested_permille ?? 0, purchaseId, item.branch_id, now, actorId),
    ...(await postGoldStmts(
      db,
      [
        {
          branchId: item.branch_id,
          source: `customer:${item.customer_id}`,
          destination: `branch:${item.branch_id}`,
          type: "OLD_GOLD_PURCHASE",
          weightMg: item.net_mg,
          permille: item.tested_permille,
          refEntity: "old_gold_purchase",
          refId: purchaseId,
          oldGoldId: itemId,
          notes: `Old gold ${item.number}`,
        },
      ],
      { actorId, auditAction: "oldgold.purchase.gold", auditEntity: "old_gold", auditEntityId: itemId, branchId: item.branch_id }
    )),
    ...journal.stmts,
    // AFTER the journal statements. The link is a foreign key, and D1 runs a
    // batch in order, so setting it on the INSERT above would reference an
    // entry that does not exist yet.
    db
      .prepare("UPDATE old_gold_purchases SET journal_entry_id = ? WHERE id = ?")
      .bind(journal.entryId, purchaseId),
    ...credit.stmts,
  ], "Item was already purchased or re-valued; reload and try again");
  return { purchaseId };
}

export async function releaseItem(db: D1Database, itemId: string, actorId: string): Promise<void> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  if (item.status !== "PURCHASED")
    throw Object.assign(new Error("Only purchased items can be released"), { code: "CONFLICT" });
  await batchOrConflict(db, [
    ...moveStmts(db, itemId, ["PURCHASED"], "status = 'AVAILABLE'", []),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.release",
      entity: "old_gold",
      entityId: itemId,
      prev: { status: "PURCHASED" },
      next: { status: "AVAILABLE" },
      branchId: item.branch_id,
    }),
  ], RACED);
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
  // Gold earmarked as the customer's own metal for a live custom order must
  // go to the melt for that order, not onto the shelf for someone else.
  const holder = await db
    .prepare(
      "SELECT o.number FROM custom_order_gold g JOIN custom_orders o ON o.id = g.order_id WHERE g.kind = 'CUSTOMER_OLDGOLD' AND g.ref_id = ? AND o.status NOT IN ('CANCELLED', 'DELIVERED')"
    )
    .bind(itemId)
    .first<{ number: string }>();
  if (holder)
    throw Object.assign(new Error(`Item is earmarked for custom order ${holder.number}`), { code: "CONFLICT" });
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
  // The product row goes first (converted_product_id references it), then the
  // guarded move: a second, racing convert rolls back its product too.
  const stmts: D1PreparedStatement[] = [...built.stmts];
  stmts.push(
    ...moveStmts(db, itemId, ["AVAILABLE"], "converted_product_id = ?, status = 'RESOLD'", [built.id]),
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
  await batchOrConflict(db, stmts, RACED);
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
  await batchOrConflict(db, [
    ...moveStmts(db, itemId, [item.status], "status = 'VOID'", []),
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
  ], RACED);
}

const MAX_FILES = 10;

/**
 * Checked BEFORE anything is written to R2, so a locked item or a full slot
 * refuses the upload instead of leaving orphan objects in the bucket.
 */
export async function assertCanAddFiles(db: D1Database, itemId: string, kind: "image" | "doc", count: number): Promise<void> {
  const item = await loadItem(db, itemId);
  rejectLocked(item.status);
  const current = JSON.parse(kind === "image" ? item.image_keys : item.doc_keys) as string[];
  if (current.length + count > MAX_FILES)
    throw Object.assign(new Error(`Max ${MAX_FILES} files per kind`), { code: "VALIDATION" });
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
  const raw = kind === "image" ? item.image_keys : item.doc_keys;
  const current = JSON.parse(raw) as string[];
  if (current.length + keys.length > MAX_FILES)
    throw Object.assign(new Error(`Max ${MAX_FILES} files per kind`), { code: "VALIDATION" });
  const next = [...current, ...keys];
  // Guarded on the list we read: two uploads at once would otherwise each
  // write their own list and one set of keys would vanish.
  await batchOrConflict(db, [
    db.prepare(`UPDATE old_gold_items SET ${col} = ? WHERE id = ? AND ${col} = ?`).bind(JSON.stringify(next), itemId, raw),
    staleGuard(db),
    buildAuditStmt(db, {
      userId: actorId,
      action: "oldgold.files_add",
      entity: "old_gold",
      entityId: itemId,
      next: { kind, keys },
      branchId: item.branch_id,
    }),
  ], "Another upload finished first; try again");
  return { keys: next };
}

export async function getItem(db: D1Database, id: string) {
  const item = await loadItem(db, id);
  const customer =
    item.customer_id === SHOP_STOCK_CUSTOMER_ID
      ? null
      : await db.prepare("SELECT id, code, name, phone FROM customers WHERE id = ?").bind(item.customer_id).first();
  const { results: tests } = await db
    .prepare("SELECT * FROM gold_tests WHERE item_id = ? ORDER BY created_at")
    .bind(id)
    .all();
  const purchase = await db
    .prepare("SELECT * FROM old_gold_purchases WHERE item_id = ?")
    .bind(id)
    .first();
  // The posted lines (account, DR/CR), not just the entry headers: headers
  // carry no account or amount, so the detail screen showed blank rows.
  const { results: journal } = await db
    .prepare(
      `SELECT l.id, l.entry_id, e.entry_no, e.entry_date, e.status AS entry_status, l.account_code, l.debit_cents, l.credit_cents, l.party_type, l.party_id
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
       WHERE e.ref_entity = 'old_gold_purchase' AND e.ref_id IN (SELECT id FROM old_gold_purchases WHERE item_id = ?)
       ORDER BY e.created_at, l.line_no`
    )
    .bind(id)
    .all();
  const { results: gold } = await db
    .prepare("SELECT * FROM gold_movements WHERE old_gold_id = ? ORDER BY created_at")
    .bind(id)
    .all();
  const converted = item.converted_product_id
    ? await db.prepare("SELECT id, barcode, sku, name, status FROM products WHERE id = ?").bind(item.converted_product_id).first()
    : null;
  const category = await db
    .prepare("SELECT cat.id, cat.name, cat.code FROM old_gold_item_categories ogc JOIN categories cat ON cat.id = ogc.category_id WHERE ogc.item_id = ?")
    .bind(id)
    .first();
  return {
    item: { ...item, image_keys: JSON.parse(item.image_keys), doc_keys: JSON.parse(item.doc_keys) },
    category,
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
  scope: string[] | null,
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
  // The route has already refused a branchId outside the caller's scope.
  const b = branchFilter("o.branch_id", opts.branchId, scope);
  if (b.sql) {
    conds.push(b.sql.replace(/^ AND /, ""));
    vals.push(...b.vals);
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
      `SELECT o.*, c.name AS customer_name, cat.name AS category_name, cat.code AS category_code
       FROM old_gold_items o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN old_gold_item_categories ogc ON ogc.item_id = o.id
       LEFT JOIN categories cat ON cat.id = ogc.category_id
       ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
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

/** `scope` null = every branch; otherwise the caller's branches (see branchAccess). */
type Scope = string[] | null;

function branchFilter(col: string, branchId: string | undefined, scope: Scope): { sql: string; vals: unknown[] } {
  if (branchId) return { sql: ` AND ${col} = ?`, vals: [branchId] };
  if (scope === null) return { sql: "", vals: [] };
  if (scope.length === 0) return { sql: " AND 1 = 0", vals: [] };
  return { sql: ` AND ${col} IN (${scope.map(() => "?").join(", ")})`, vals: [...scope] };
}

/**
 * Intake counts (items, gross) follow the intake date; money and fine gold
 * follow the PURCHASE date and the purchase record. Filtering bought items by
 * current status dropped every item from the totals the moment it went to the
 * melt (RESERVED_FOR_MELTING / MELTED), so last month's buy-ins shrank daily.
 */
export async function oldgoldSummary(db: D1Database, opts: { from: number; to: number; branchId?: string; scope?: Scope }) {
  const b = branchFilter("o.branch_id", opts.branchId, opts.scope ?? null);
  const head = await db
    .prepare(
      `SELECT COUNT(*) AS items, COALESCE(SUM(o.gross_mg), 0) AS gross_mg FROM old_gold_items o
       WHERE o.created_at >= ? AND o.created_at <= ? AND o.status != 'VOID'${b.sql}`
    )
    .bind(opts.from, opts.to, ...b.vals)
    .first<{ items: number; gross_mg: number }>();
  const bought = await db
    .prepare(
      `SELECT COUNT(*) AS bought, COALESCE(SUM(o.fine_mg), 0) AS fine_mg, COALESCE(SUM(p.value_cents), 0) AS value_cents, COALESCE(SUM(p.paid_cents), 0) AS paid_cents
       FROM old_gold_purchases p JOIN old_gold_items o ON o.id = p.item_id
       WHERE p.created_at >= ? AND p.created_at <= ?${b.sql}`
    )
    .bind(opts.from, opts.to, ...b.vals)
    .first<{ bought: number; fine_mg: number; value_cents: number; paid_cents: number }>();
  return {
    items: head?.items ?? 0,
    gross_mg: head?.gross_mg ?? 0,
    bought: bought?.bought ?? 0,
    fine_mg: bought?.fine_mg ?? 0,
    value_cents: bought?.value_cents ?? 0,
    paid_cents: bought?.paid_cents ?? 0,
    outstanding_cents: (bought?.value_cents ?? 0) - (bought?.paid_cents ?? 0),
  };
}

export async function oldgoldBreakdown(
  db: D1Database,
  opts: { from: number; to: number; branchId?: string; scope?: Scope; groupBy: "purity" | "customer" | "branch" }
) {
  // Customers group by id (two people can share a name) and branches show
  // their name rather than a raw id.
  const key =
    opts.groupBy === "purity"
      ? "COALESCE(o.karat, CAST(o.tested_permille AS TEXT))"
      : opts.groupBy === "customer"
        ? "o.customer_id"
        : "o.branch_id";
  const label = opts.groupBy === "purity" ? key : opts.groupBy === "customer" ? "MAX(c.name)" : "MAX(br.name)";
  const join =
    opts.groupBy === "customer"
      ? "LEFT JOIN customers c ON c.id = o.customer_id"
      : opts.groupBy === "branch"
        ? "LEFT JOIN branches br ON br.id = o.branch_id"
        : "";
  const b = branchFilter("o.branch_id", opts.branchId, opts.scope ?? null);
  const { results } = await db
    .prepare(
      `SELECT ${label} AS key, ${key} AS group_id, COUNT(*) AS items, COALESCE(SUM(p.value_cents), 0) AS value_cents, COALESCE(SUM(o.fine_mg), 0) AS fine_mg
       FROM old_gold_purchases p JOIN old_gold_items o ON o.id = p.item_id ${join}
       WHERE p.created_at >= ? AND p.created_at <= ?${b.sql}
       GROUP BY ${key} ORDER BY value_cents DESC`
    )
    .bind(opts.from, opts.to, ...b.vals)
    .all();
  return results ?? [];
}

/**
 * Old gold held in stock (bought or on the shelf): its weight, fine and value,
 * and the weight by karat. These are the pieces products are made from.
 */
export async function stockOnHand(db: D1Database, branchId?: string, scope: Scope = null) {
  const b = branchFilter("o.branch_id", branchId, scope);
  const { results } = await db
    .prepare(
      `SELECT o.karat AS karat, o.tested_permille AS permille, COUNT(*) AS items,
              COALESCE(SUM(o.net_mg), 0) AS net_mg, COALESCE(SUM(o.fine_mg), 0) AS fine_mg,
              COALESCE(SUM(o.purchase_value_cents), 0) AS value_cents
       FROM old_gold_items o
       WHERE o.status IN ('PURCHASED', 'AVAILABLE') AND o.net_mg > 0${b.sql}
       GROUP BY o.tested_permille, o.karat
       ORDER BY o.tested_permille DESC`
    )
    .bind(...b.vals)
    .all<{ karat: string | null; permille: number | null; items: number; net_mg: number; fine_mg: number; value_cents: number }>();
  const rows = results ?? [];
  const sum = (k: "items" | "net_mg" | "fine_mg" | "value_cents") => rows.reduce((n, r) => n + r[k], 0);
  return {
    items: sum("items"),
    netMg: sum("net_mg"),
    fineMg: sum("fine_mg"),
    valueCents: sum("value_cents"),
    byKarat: rows.map((r) => ({ karat: r.karat, permille: r.permille, items: r.items, netMg: r.net_mg, fineMg: r.fine_mg })),
  };
}

export async function pendingList(db: D1Database, branchId?: string, scope: Scope = null) {
  const b = branchFilter("o.branch_id", branchId, scope);
  const { results } = await db
    .prepare(
      `SELECT o.id, o.number, o.description, o.fine_mg, o.purchase_value_cents, o.status, o.created_at, c.name AS customer_name FROM old_gold_items o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.status IN ('PURCHASED', 'AVAILABLE')${b.sql} ORDER BY o.created_at DESC LIMIT 100`
    )
    .bind(...b.vals)
    .all();
  return results ?? [];
}

export async function customerOldgold(db: D1Database, customerId: string, scope: Scope = null) {
  const b = branchFilter("o.branch_id", undefined, scope);
  const { results: items } = await db
    .prepare(
      `SELECT o.id, o.number, o.description, o.net_mg, o.fine_mg, o.purchase_value_cents, o.paid_cents, o.status, o.created_at,
              CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS purchased
       FROM old_gold_items o LEFT JOIN old_gold_purchases p ON p.item_id = o.id
       WHERE o.customer_id = ? AND o.status != 'VOID'${b.sql} ORDER BY o.created_at DESC`
    )
    .bind(customerId, ...b.vals)
    .all();
  const rows = (items ?? []) as { purchase_value_cents: number | null; paid_cents: number; purchased: number }[];
  // Only bought items are money owed: a VALUED item is a quote the customer
  // may still walk away with, not a debt.
  const bought = rows.filter((r) => r.purchased === 1);
  const value = bought.reduce((s, r) => s + (r.purchase_value_cents ?? 0), 0);
  const paid = bought.reduce((s, r) => s + r.paid_cents, 0);
  return { items: rows, totals: { items: rows.length, value_cents: value, paid_cents: paid, outstanding_cents: value - paid } };
}
