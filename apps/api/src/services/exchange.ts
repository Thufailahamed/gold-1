import { gToMg, lkrToCents, type ExchangeSaleInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
import { postGoldStmts } from "./gold";
import { batchOrConflict, staleGuard } from "./guard";
import { creditToOpenBills } from "./receipts";
import { intakeStatements } from "./oldgold";
import { buildReceiveSaleStmts } from "./sales";

/** Purity the counter records for old gold taken in with a sale (22K). */
const TAKE_IN_PERMILLE = 916;

/**
 * Old-for-new exchange: the shop buys the customer's jewellery (VALUED
 * old-gold items) and sells new pieces against it, in ONE atomic batch. The
 * customer pays the difference through the sale's payment legs; when the old
 * gold is worth more than the bill, the shop pays the difference out of the
 * drawer — or leaves it as store credit on the customer's account.
 *
 * Posting, two entries composed with the sale's statements so a failure in
 * any half rolls back both:
 *
 *   old-gold purchase entry (ref_entity old_gold_purchase)
 *     DR 1100 full old-gold value (customer party)
 *     CR 1000 the cash surplus paid to the customer
 *     CR 1200 the rest — the offset the sale settles, and a leftover store
 *             credit when the payout went to the account
 *
 *   sale entry (ref_entity sale_invoice) — the standard sale posting, with
 *     the offset as a credit-method leg against the customer's party.
 *
 * The customer's 1200 balance therefore nets to zero unless the surplus was
 * left as store credit — the shop owes it, explained by the old_gold_purchase
 * ref the party-ledger check whitelists. Both entries reuse recognized
 * ref_entities, so the day-close classification and the payments cross-foot
 * read the exchange like the purchase and sale it is made of.
 */
/** The request as the route parses it, or as a caller builds it (where new old gold may be left out). */
type ExchangeInput = Omit<ExchangeSaleInput, "newOldGold"> & { newOldGold?: ExchangeSaleInput["newOldGold"] };

export async function exchangeSale(
  db: D1Database,
  input: ExchangeInput,
  actorId: string
): Promise<{
  invoiceId: string;
  number: string;
  oldGoldValueCents: number;
  /** Old gold that cleared the customer's open bills before the new bill. */
  /** Credit left after the bill that settled the customer's open bills. */
  creditedOpenCents: number;
  saleTotalCents: number;
  customerPaysCents: number;
  shopPaysCents: number;
  payout: "cash" | "store_credit";
}> {
  const customer = await db
    .prepare("SELECT id, name FROM customers WHERE id = ? AND is_active = 1")
    .bind(input.customerId)
    .first<{ id: string; name: string }>();
  if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  if (new Set(input.oldGoldItemIds).size !== input.oldGoldItemIds.length)
    throw Object.assign(new Error("An old-gold item appears more than once in the exchange"), {
      code: "VALIDATION",
    });

  // Every exchanged item must be a valued offer to THIS customer at THIS
  // branch, not yet bought, and not already swept into a melting batch.
  type Old = {
    id: string;
    number: string;
    status: string;
    customer_id: string;
    branch_id: string;
    net_mg: number;
    tested_permille: number | null;
    fine_mg: number;
    purchase_value_cents: number | null;
  };
  const olds: Old[] = [];
  for (const itemId of input.oldGoldItemIds) {
    const item = await db
      .prepare("SELECT * FROM old_gold_items WHERE id = ?")
      .bind(itemId)
      .first<Old>();
    if (!item) throw Object.assign(new Error("Old-gold item not found"), { code: "NOT_FOUND" });
    if (["RESERVED_FOR_MELTING", "MELTED", "TRANSFERRED"].includes(item.status))
      throw Object.assign(new Error("Melting-phase status, locked"), { code: "TRANSITION_LOCKED" });
    if (item.customer_id !== input.customerId)
      throw Object.assign(
        new Error(`Old gold ${item.number} was brought in by another customer`),
        { code: "VALIDATION" }
      );
    if (item.branch_id !== input.branchId)
      throw Object.assign(new Error(`Old gold ${item.number} is at another branch`), { code: "VALIDATION" });
    if (item.status !== "VALUED")
      throw Object.assign(new Error(`Old gold ${item.number} needs a valuation first`), { code: "CONFLICT" });
    if (item.purchase_value_cents === null || item.purchase_value_cents <= 0)
      throw Object.assign(new Error(`Old gold ${item.number} has no valuation`), { code: "VALIDATION" });
    if (item.tested_permille === null || item.tested_permille <= 0 || item.tested_permille > 1000)
      throw Object.assign(new Error(`Old gold ${item.number} has no tested purity`), { code: "VALIDATION" });
    if (item.net_mg <= 0)
      throw Object.assign(new Error(`Old gold ${item.number} has no net weight`), { code: "VALIDATION" });
    olds.push(item);
  }
  // Old gold brought in with this sale is recorded here, as statements in the
  // same batch as the sale: a sale that fails, or is never completed, leaves no
  // piece behind. Each piece is recorded already valued, at the counter's
  // purity and the amount the cashier paid.
  const newPieces = input.newOldGold ?? [];
  if (olds.length === 0 && newPieces.length === 0)
    throw Object.assign(new Error("Take in at least one piece of old gold"), { code: "VALIDATION" });
  const intakeStmts: D1PreparedStatement[] = [];
  for (const p of newPieces) {
    const purity = await db
      .prepare("SELECT id, karat FROM purities WHERE permille = ? AND is_active = 1")
      .bind(TAKE_IN_PERMILLE)
      .first<{ id: string; karat: string }>();
    const grossMg = gToMg(p.grossG);
    const fineMg = Math.round((grossMg * TAKE_IN_PERMILLE) / 1000);
    const valueCents = lkrToCents(p.valueLkr);
    const notes = "Taken in at the counter with an exchange";
    // The same intake the desk uses: the piece is recorded with its description,
    // then valued at the typed amount, so it sits in the same old gold list.
    const built = await intakeStatements(
      db,
      {
        customerId: customer.id,
        branchId: input.branchId,
        itemType: "Old gold",
        description: p.description?.trim() || `Old gold, ${p.grossG} g`,
        categoryId: p.categoryId,
        // The till tests the piece itself (touchstone), below, so it waits as received.
        needsTesting: true,
        grossG: p.grossG,
        stoneG: 0,
        notes,
      },
      actorId
    );
    intakeStmts.push(
      ...built.stmts,
      db
        .prepare(
          "UPDATE old_gold_items SET purity_id = ?, tested_permille = ?, karat = ?, fine_mg = ?, purchase_rate_cents = ?, negotiated_cents = ?, purchase_value_cents = ?, status = 'VALUED' WHERE id = ? AND status = 'RECEIVED'"
        )
        .bind(
          purity?.id ?? null,
          TAKE_IN_PERMILLE,
          purity?.karat ?? null,
          fineMg,
          fineMg > 0 ? Math.round((valueCents / fineMg) * 1000) : 0,
          valueCents,
          valueCents,
          built.id
        ),
      db
        .prepare(
          "INSERT INTO gold_tests (id, item_id, method, tested_permille, tester_id, result, approved_by, notes, created_at) VALUES (?, ?, 'touchstone', ?, ?, 'pass', NULL, ?, ?)"
        )
        .bind(crypto.randomUUID(), built.id, TAKE_IN_PERMILLE, actorId, notes, Date.now())
    );
    olds.push({
      id: built.id,
      number: built.number,
      status: "VALUED",
      customer_id: customer.id,
      branch_id: input.branchId,
      net_mg: grossMg,
      tested_permille: TAKE_IN_PERMILLE,
      fine_mg: fineMg,
      purchase_value_cents: valueCents,
    });
  }

  const oldGoldValueCents = olds.reduce((s, o) => s + (o.purchase_value_cents ?? 0), 0);


  // The sale half — priced, validated and built as statements, not yet run.
  const sale = await buildReceiveSaleStmts(
    db,
    {
      customerId: input.customerId,
      branchId: input.branchId,
      salespersonId: input.salespersonId,
      items: input.items,
      payments: input.payments,
      notes: input.notes,
    },
    actorId,
    { enforceShelfPrice: true, enforceCreditLimit: true, exchangeOldValueCents: oldGoldValueCents }
  );
  const payoutCents = input.payout === "cash" ? sale.exchangeSurplusCents : 0;

  const now = Date.now();
  const entryDate = await businessDateFor(db, now);
  const stmts: D1PreparedStatement[] = [];
  // The cash surplus is allocated across the items in the order given, each
  // paid up to its own value, so every old_gold_purchases row carries its
  // share and the sum equals what left the drawer.
  let remainingPayout = payoutCents;
  let firstPurchaseId: string | null = null;
  const purchaseIds: string[] = [];
  for (const item of olds) {
    const valueCents = item.purchase_value_cents ?? 0;
    const paidCents = Math.min(remainingPayout, valueCents);
    remainingPayout -= paidCents;
    const purchaseId = crypto.randomUUID();
    purchaseIds.push(purchaseId);
    firstPurchaseId ??= purchaseId;
    stmts.push(
      // Guarded on VALUED and on the value the customer was quoted: a racing
      // second exchange (or a re-valuation in between) changes no row and the
      // whole batch — both entries, gold ledger and audit — rolls back.
      db
        .prepare(
          "UPDATE old_gold_items SET paid_cents = ?, status = 'PURCHASED' WHERE id = ? AND status = 'VALUED' AND purchase_value_cents = ?"
        )
        .bind(paidCents, item.id, valueCents),
      staleGuard(db),
      db
        .prepare(
          "INSERT INTO old_gold_purchases (id, item_id, value_cents, paid_cents, method, sales_invoice_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(purchaseId, item.id, valueCents, paidCents, input.payout === "cash" ? "cash" : "store_credit", sale.invoiceId, now, actorId),
      db
        .prepare(
          "INSERT INTO gold_movements (id, product_id, old_gold_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by) VALUES (?, NULL, ?, 'IN', ?, ?, 'old_gold_purchase', ?, ?, ?, ?)"
        )
        .bind(crypto.randomUUID(), item.id, item.fine_mg, item.tested_permille ?? 0, purchaseId, input.branchId, now, actorId),
    );
    stmts.push(
      ...(await postGoldStmts(
        db,
        [
          {
            branchId: input.branchId,
            source: `customer:${input.customerId}`,
            destination: `branch:${input.branchId}`,
            type: "OLD_GOLD_PURCHASE",
            weightMg: item.net_mg,
            permille: item.tested_permille ?? 0,
            refEntity: "old_gold_purchase",
            refId: purchaseId,
            oldGoldId: item.id,
            notes: `Old gold ${item.number} — exchange for invoice ${sale.number}`,
          },
        ],
        { actorId, auditAction: "exchange.purchase.gold", auditEntity: "sale_invoice", auditEntityId: sale.invoiceId, branchId: input.branchId }
      ))
    );
  }

  const lines: { account: string; debitCents: number; creditCents: number; partyType?: "customer"; partyId?: string }[] = [
    { account: "1100", debitCents: oldGoldValueCents, creditCents: 0, partyType: "customer" as const, partyId: customer.id },
  ];
  // A zero credit line is rejected by the journal ("debit XOR credit"), which
  // made a fully-offset exchange (nothing out of the drawer) impossible.
  if (payoutCents > 0) lines.push({ account: "1000", debitCents: 0, creditCents: payoutCents });
  lines.push({
    account: "1200",
    debitCents: 0,
    creditCents: oldGoldValueCents - payoutCents,
    partyType: "customer" as const,
    partyId: customer.id,
  });
  const journal = await buildEntryStmts(
    db,
    {
      lines,
      refEntity: "old_gold_purchase",
      refId: firstPurchaseId!,
      refNo: olds[0]!.number,
      memo: `Old gold exchange for invoice ${sale.number}`,
      branchId: input.branchId,
      actorId,
      auditAction: "exchange.purchase",
      auditEntity: "sale_invoice",
      auditEntityId: sale.invoiceId,
      sourceModule: "sales",
    },
    { entryDate }
  );
  stmts.push(...journal.stmts);
  // AFTER the journal statements: the link is a foreign key and D1 runs a
  // batch in order.
  for (const purchaseId of purchaseIds)
    stmts.push(db.prepare("UPDATE old_gold_purchases SET journal_entry_id = ? WHERE id = ?").bind(journal.entryId, purchaseId));
  stmts.push(
    buildAuditStmt(db, {
      userId: actorId,
      action: "sale.exchange_oldgold",
      entity: "sale_invoice",
      entityId: sale.invoiceId,
      next: {
        invoiceNumber: sale.number,
        oldGoldItemIds: input.oldGoldItemIds,
        oldGoldValueCents,
        saleTotalCents: sale.totalCents,
        customerPaysCents: sale.totalCents - sale.exchangeOffsetCents,
        shopPaysCents: payoutCents,
        payout: input.payout,
      },
      branchId: input.branchId,
    })
  );

  // The two halves are independent statements — the sale reads nothing the
  // purchase writes and vice versa — so the purchase may follow the sale in
  // the one batch, even though it was priced first. A lost race (the guard
  // fired) surfaces as CONFLICT, not a raw 500.
  // The intake of new pieces goes first: the purchase statements below update
  // those rows, and D1 runs a batch in order.
  // Old gold left over after the bill goes to the customer's credit (store-credit payout): it settles their open bills, oldest first.
  const credit = await creditToOpenBills(db, customer.id, input.payout === "store_credit" ? sale.exchangeSurplusCents : 0);
  await batchOrConflict(db, [...intakeStmts, ...sale.stmts, ...credit.stmts, ...stmts], "Item was already exchanged or bought; reload and try again");
  return {
    invoiceId: sale.invoiceId,
    number: sale.number,
    oldGoldValueCents,
    creditedOpenCents: credit.appliedCents,
    saleTotalCents: sale.totalCents,
    customerPaysCents: sale.totalCents - sale.exchangeOffsetCents,
    shopPaysCents: payoutCents,
    payout: input.payout,
  };
}
