import {
  approveExpenseSchema,
  cardSettlementSchema,
  cashEntrySchema,
  cashMoveSchema,
  closeDaySchema,
  createExpenseSchema,
  customerReceiptSchema,
  CASH_ENTRY_KINDS,
  expensePosting,
  payInvoiceSchema,
  PERMISSIONS,
  rejectExpenseSchema,
  taxPaymentSchema,
  transferDispatchSchema,
  transferReceiveSchema,
} from "@goldos/shared";
import { z } from "zod";
import { expenseThresholdsFor } from "../../services/expenses";
import { requireBranch, toolError, type AssistantContext } from "../context";
import { formatLkr } from "../present";
import { checkBody, defineTool, p, params, toCents, type ActionDraft, type AnyTool } from "./kit";
import { branchName, findAccount, findBankAccount, findDocument, findExpenseCategory, findParty } from "./lookup";

/**
 * Write tools never write. Each one resolves names to records, builds the
 * exact request body the existing route expects, checks it against that
 * route's own schema, and returns a draft. The draft becomes a PENDING action
 * the user sees as a confirm card; only their click sends it — to the real
 * route, under their own session — so permissions, approvals, thresholds,
 * day and year locks, idempotency and the audit trail all apply unchanged.
 */

const MANAGE = [PERMISSIONS.ACCOUNTS_MANAGE];

/** Mirrors the routes' own adjustment and reverse schemas (local to routes/accounts.ts). */
const adjustBody = z.object({
  debitAccount: z.string().min(1),
  creditAccount: z.string().min(1),
  amountCents: z.number().int().gt(0),
  memo: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
  branchId: z.string().min(1),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const reverseBody = z.object({
  entryId: z.string().min(1),
  reason: z.string().min(1).max(500),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function notFuture(ctx: AssistantContext, d: string | undefined, what: string): string | undefined {
  if (d && d > ctx.today) toolError("VALIDATION", `${what} ${d} is in the future; today is ${ctx.today}`);
  return d;
}

function draft(d: ActionDraft): ActionDraft {
  return { ...d, lines: d.lines.filter(Boolean) };
}

const dateLine = (label: string, d: string | undefined, today: string) => `${label}: ${d ?? `${today} (today)`}`;

const money = (lkr: number) => formatLkr(toCents(lkr));

export const writeTools: AnyTool[] = [
  defineTool({
    name: "propose_expense",
    kind: "write",
    perms: MANAGE,
    description:
      "Propose recording a shop expense (rent, electricity, salaries, repairs…). Paid from the branch cash drawer or a bank account. On confirm it posts to the ledger at once, whatever the amount; above the receipt threshold a receipt must then be attached on the Expenses screen.",
    params: params({
      category: p.str("Expense category name or id (see expense_categories).", 100),
      amountLkr: p.lkr("Amount."),
      description: p.str("What it was for.", 500),
      paidFrom: p.enm(["cash", "bank"], "Cash from the drawer, or a bank account."),
      bankAccount: p.opt(p.str("Bank account name or id, when paidFrom is bank.", 100)),
      branch: p.opt(p.str("Branch that incurred it.", 100)),
      incurredOn: p.opt(p.date("Date incurred. Defaults to today.")),
      vendor: p.opt(p.str("Who was paid.", 100)),
    }),
    run: async (ctx, a) => {
      const branch = requireBranch(ctx, a.branch);
      const cat = await findExpenseCategory(ctx, a.category);
      if (a.paidFrom === "bank" && !a.bankAccount) toolError("VALIDATION", "Which bank account was it paid from? Ask the user.");
      const bank = a.paidFrom === "bank" && a.bankAccount ? await findBankAccount(ctx, a.bankAccount) : null;
      notFuture(ctx, a.incurredOn, "Expense date");
      const body = checkBody(createExpenseSchema, {
        categoryId: cat.id,
        branchId: branch.id,
        amountLkr: a.amountLkr,
        description: a.description,
        incurredOn: a.incurredOn,
        vendor: a.vendor,
        paidFrom: a.paidFrom,
        bankAccountId: bank?.id,
      });
      const gates = expensePosting(toCents(a.amountLkr), await expenseThresholdsFor(ctx.db));
      return draft({
        title: `Record expense ${money(a.amountLkr)} — ${cat.name}`,
        lines: [
          `Category: ${cat.name} (account ${cat.account_code})`,
          `Amount: ${money(a.amountLkr)}`,
          `Description: ${a.description}`,
          a.vendor ? `Paid to: ${a.vendor}` : "",
          `Paid from: ${bank ? bank.label : `${branch.name} cash drawer (1000)`}`,
          `Branch: ${branch.name}`,
          dateLine("Date", a.incurredOn, ctx.today),
          // createExpense posts every expense at once (no approval gate), so
          // the card must not promise one.
          gates.requiresReceipt ? "A receipt must be attached on the Expenses screen." : "",
        ],
        method: "POST",
        path: "/api/v1/expenses",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_expense_decision",
    kind: "write",
    perms: MANAGE,
    description: "Propose approving or rejecting an expense that is awaiting approval. The requester cannot approve their own.",
    params: params({
      expense: p.str("Expense number (e.g. EXP-000045) or id.", 80),
      decision: p.enm(["approve", "reject"], "Approve or reject."),
      reason: p.opt(p.str("Reason (required to reject).", 500)),
    }),
    run: async (ctx, a) => {
      const e = await findDocument<{ id: string; number: string; branch_id: string; amount_cents: number; description: string; status: string; requested_by: string | null }>(
        ctx,
        "expense",
        "expenses",
        "id, number, amount_cents, description, status, requested_by",
        a.expense
      );
      if (e.status !== "PENDING_APPROVAL") toolError("CONFLICT", `${e.number} is ${e.status}, not awaiting approval.`);
      if (e.requested_by === ctx.userId) toolError("FORBIDDEN", `${e.number} was requested by this user; someone else must decide it.`);
      const body =
        a.decision === "approve"
          ? checkBody(approveExpenseSchema, { reason: a.reason })
          : checkBody(rejectExpenseSchema, { reason: a.reason ?? "" });
      return draft({
        title: `${a.decision === "approve" ? "Approve" : "Reject"} expense ${e.number}`,
        lines: [
          `Expense: ${e.number} — ${e.description}`,
          `Amount: ${formatLkr(e.amount_cents)}`,
          `Branch: ${branchName(ctx, e.branch_id)}`,
          a.reason ? `Reason: ${a.reason}` : "",
          a.decision === "approve" ? "On approval it posts to the ledger." : "",
        ],
        method: "POST",
        path: `/api/v1/expenses/${encodeURIComponent(e.id)}/${a.decision}`,
        body,
      });
    },
  }),

  defineTool({
    name: "propose_cash_entry",
    kind: "write",
    perms: MANAGE,
    description:
      "Propose an owner or miscellaneous cash/bank movement: OWNER_CAPITAL (owner put money in), OWNER_DRAWING (owner took money out), OTHER_INCOME, CASH_OVER (found extra), CASH_SHORT (missing).",
    params: params({
      kind: p.enm(["OWNER_CAPITAL", "OWNER_DRAWING", "OTHER_INCOME", "CASH_OVER", "CASH_SHORT"], "What kind of movement."),
      amountLkr: p.lkr("Amount."),
      method: p.enm(["cash", "bank"], "Cash drawer or bank."),
      bankAccount: p.opt(p.str("Bank account, when method is bank.", 100)),
      note: p.str("Why.", 500),
      branch: p.opt(p.str("Branch.", 100)),
      entryDate: p.opt(p.date("Date. Defaults to today.")),
    }),
    run: async (ctx, a) => {
      const branch = requireBranch(ctx, a.branch);
      if (a.method === "bank" && !a.bankAccount) toolError("VALIDATION", "Which bank account? Ask the user.");
      const bank = a.method === "bank" && a.bankAccount ? await findBankAccount(ctx, a.bankAccount) : null;
      notFuture(ctx, a.entryDate, "Date");
      const body = checkBody(cashEntrySchema, {
        branchId: branch.id,
        kind: a.kind,
        amountCents: toCents(a.amountLkr),
        method: a.method,
        bankAccountId: bank?.id,
        entryDate: a.entryDate,
        note: a.note,
      });
      const k = CASH_ENTRY_KINDS[a.kind];
      return draft({
        title: `${k.label}: ${money(a.amountLkr)}`,
        lines: [
          `Type: ${k.label} (${k.direction === "in" ? "money in" : "money out"}, against account ${k.counterAccount})`,
          `Amount: ${money(a.amountLkr)}`,
          `${k.direction === "in" ? "Into" : "From"}: ${bank ? bank.label : `${branch.name} cash drawer (1000)`}`,
          `Branch: ${branch.name}`,
          dateLine("Date", a.entryDate, ctx.today),
          `Note: ${a.note}`,
        ],
        method: "POST",
        path: "/api/v1/cash/entries",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_bank_deposit_or_withdrawal",
    kind: "write",
    perms: MANAGE,
    description: "Propose moving cash between a branch drawer and a bank account: deposit (drawer to bank) or withdrawal (bank to drawer).",
    params: params({
      direction: p.enm(["deposit", "withdrawal"], "deposit = drawer to bank; withdrawal = bank to drawer."),
      bankAccount: p.str("Bank account name or id.", 100),
      amountLkr: p.lkr("Amount."),
      branch: p.opt(p.str("Branch whose drawer.", 100)),
      note: p.opt(p.str("Note.", 500)),
      entryDate: p.opt(p.date("Date. Defaults to today.")),
    }),
    run: async (ctx, a) => {
      const branch = requireBranch(ctx, a.branch);
      const bank = await findBankAccount(ctx, a.bankAccount);
      notFuture(ctx, a.entryDate, "Date");
      const body = checkBody(cashMoveSchema, {
        branchId: branch.id,
        bankAccountId: bank.id,
        amountCents: toCents(a.amountLkr),
        note: a.note,
        entryDate: a.entryDate,
      });
      const dep = a.direction === "deposit";
      return draft({
        title: `${dep ? "Deposit" : "Withdraw"} ${money(a.amountLkr)} ${dep ? "to" : "from"} ${bank.name}`,
        lines: [
          `${dep ? "From" : "To"}: ${branch.name} cash drawer (1000)`,
          `${dep ? "To" : "From"}: ${bank.label}`,
          `Amount: ${money(a.amountLkr)}`,
          dateLine("Date", a.entryDate, ctx.today),
          a.note ? `Note: ${a.note}` : "",
        ],
        method: "POST",
        path: dep ? "/api/v1/cash/deposits" : "/api/v1/cash/withdrawals",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_cash_transfer",
    kind: "write",
    perms: MANAGE,
    description: "Propose sending cash from one branch to another. It sits in Cash in Transit (1030) until the receiving branch records it.",
    params: params({
      fromBranch: p.str("Sending branch.", 100),
      toBranch: p.str("Receiving branch.", 100),
      amountLkr: p.lkr("Amount."),
      reason: p.str("Why.", 500),
      sentOn: p.opt(p.date("Date sent. Defaults to today.")),
    }),
    run: async (ctx, a) => {
      const from = requireBranch(ctx, a.fromBranch);
      const to = requireBranch(ctx, a.toBranch);
      if (from.id === to.id) toolError("VALIDATION", "The two branches must be different.");
      notFuture(ctx, a.sentOn, "Date");
      const body = checkBody(transferDispatchSchema, {
        fromBranchId: from.id,
        toBranchId: to.id,
        amountCents: toCents(a.amountLkr),
        sentOn: a.sentOn,
        reason: a.reason,
      });
      return draft({
        title: `Send ${money(a.amountLkr)} from ${from.name} to ${to.name}`,
        lines: [
          `From: ${from.name} cash drawer`,
          `To: ${to.name} (must be recorded as received there)`,
          `Amount: ${money(a.amountLkr)}`,
          dateLine("Sent on", a.sentOn, ctx.today),
          `Reason: ${a.reason}`,
        ],
        method: "POST",
        path: "/api/v1/cash/transfers",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_receive_cash_transfer",
    kind: "write",
    perms: MANAGE,
    description: "Propose recording that a cash transfer sent from another branch has arrived.",
    params: params({
      transfer: p.str("Transfer number or id (see cash_transfers with status IN_TRANSIT).", 80),
      receivedOn: p.opt(p.date("Date received. Defaults to today.")),
      note: p.opt(p.str("Note.", 500)),
    }),
    run: async (ctx, a) => {
      const t = await findDocument<{ id: string; number: string; branch_id: string; amount_cents: number; status: string; from_branch_id: string }>(
        ctx,
        "cash transfer",
        "cash_transfers",
        "id, number, amount_cents, status, from_branch_id",
        a.transfer,
        "to_branch_id"
      );
      if (t.status !== "IN_TRANSIT") toolError("CONFLICT", `${t.number} is ${t.status}, not waiting to be received.`);
      notFuture(ctx, a.receivedOn, "Date");
      const body = checkBody(transferReceiveSchema, { receivedOn: a.receivedOn, note: a.note });
      return draft({
        title: `Receive transfer ${t.number} (${formatLkr(t.amount_cents)})`,
        lines: [
          `Transfer: ${t.number}`,
          `From: ${branchName(ctx, t.from_branch_id)}`,
          `Into: ${branchName(ctx, t.branch_id)} cash drawer`,
          `Amount: ${formatLkr(t.amount_cents)}`,
          dateLine("Received on", a.receivedOn, ctx.today),
          a.note ? `Note: ${a.note}` : "",
        ],
        method: "POST",
        path: `/api/v1/cash/transfers/${encodeURIComponent(t.id)}/receive`,
        body,
      });
    },
  }),

  defineTool({
    name: "propose_customer_receipt",
    kind: "write",
    perms: MANAGE,
    description: "Propose recording money a customer paid against what they owe. It is applied to their oldest open invoices first.",
    params: params({
      customer: p.str("Customer name, code, phone or id.", 120),
      amountLkr: p.lkr("Amount received."),
      method: p.enm(["cash", "bank", "card"], "How they paid."),
      bankAccount: p.opt(p.str("Bank account, when method is bank.", 100)),
      branch: p.opt(p.str("Branch receiving it.", 100)),
      receiptDate: p.opt(p.date("Date. Defaults to today.")),
      note: p.opt(p.str("Note.", 500)),
    }),
    run: async (ctx, a) => {
      const branch = requireBranch(ctx, a.branch);
      const c = await findParty(ctx, "customers", a.customer);
      if (a.method === "bank" && !a.bankAccount) toolError("VALIDATION", "Which bank account was it paid into? Ask the user.");
      const bank = a.method === "bank" && a.bankAccount ? await findBankAccount(ctx, a.bankAccount) : null;
      notFuture(ctx, a.receiptDate, "Date");
      const owes = await ctx.db
        .prepare(
          `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_code = '1200' AND l.party_type = 'customer' AND l.party_id = ? AND e.branch_id = ?`
        )
        .bind(c.id, branch.id)
        .first<{ n: number }>();
      const body = checkBody(customerReceiptSchema, {
        customerId: c.id,
        branchId: branch.id,
        amountCents: toCents(a.amountLkr),
        method: a.method,
        bankAccountId: bank?.id,
        receiptDate: a.receiptDate,
        note: a.note,
      });
      const balance = owes?.n ?? 0;
      return draft({
        title: `Receive ${money(a.amountLkr)} from ${c.name}`,
        lines: [
          `Customer: ${c.label}`,
          `Amount: ${money(a.amountLkr)} by ${a.method}${bank ? ` into ${bank.label}` : ""}`,
          `Branch: ${branch.name}`,
          `They owe at this branch now: ${formatLkr(balance)}`,
          toCents(a.amountLkr) > balance ? "This is more than they owe at this branch — the excess becomes customer credit." : "",
          dateLine("Date", a.receiptDate, ctx.today),
          a.note ? `Note: ${a.note}` : "",
        ],
        method: "POST",
        path: "/api/v1/receipts",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_supplier_payment",
    kind: "write",
    perms: [PERMISSIONS.PURCHASES_EDIT],
    description: "Propose paying a supplier against one unpaid purchase invoice, from a registered bank/cash account (see bank_accounts).",
    params: params({
      invoice: p.str("Purchase invoice number or id (see supplier_account).", 80),
      amountLkr: p.lkr("Amount to pay."),
      bankAccount: p.str("Account the payment comes from.", 100),
    }),
    run: async (ctx, a) => {
      const inv = await findDocument<{ id: string; number: string; branch_id: string; total_cents: number; paid_cents: number; status: string; supplier_id: string }>(
        ctx,
        "purchase invoice",
        "purchase_invoices",
        "id, number, total_cents, paid_cents, status, supplier_id",
        a.invoice
      );
      if (inv.status === "VOID") toolError("CONFLICT", `${inv.number} is voided.`);
      const outstanding = inv.total_cents - inv.paid_cents;
      if (toCents(a.amountLkr) > outstanding)
        toolError("VALIDATION", `Only ${formatLkr(outstanding)} is outstanding on ${inv.number}.`);
      const bank = await findBankAccount(ctx, a.bankAccount);
      const supplier = await ctx.db.prepare("SELECT name FROM suppliers WHERE id = ?").bind(inv.supplier_id).first<{ name: string }>();
      const body = checkBody(payInvoiceSchema, { amountLkr: a.amountLkr, bankAccountId: bank.id });
      return draft({
        title: `Pay ${money(a.amountLkr)} on ${inv.number}`,
        lines: [
          `Supplier: ${supplier?.name ?? inv.supplier_id}`,
          `Invoice: ${inv.number} — total ${formatLkr(inv.total_cents)}, paid ${formatLkr(inv.paid_cents)}, outstanding ${formatLkr(outstanding)}`,
          `Paying: ${money(a.amountLkr)} from ${bank.label}`,
          `Leaves outstanding: ${formatLkr(outstanding - toCents(a.amountLkr))}`,
        ],
        method: "POST",
        path: `/api/v1/purchases/invoices/${encodeURIComponent(inv.id)}/payments`,
        body,
      });
    },
  }),

  defineTool({
    name: "propose_tax_payment",
    kind: "write",
    perms: MANAGE,
    description: "Propose recording a sales tax (VAT) payment to the authority for a period. Check vat_report first for the amount due.",
    params: params({
      periodFrom: p.date("Tax period start."),
      periodTo: p.date("Tax period end."),
      amountLkr: p.lkr("Amount paid."),
      method: p.enm(["cash", "bank"], "Paid in cash or from a bank."),
      bankAccount: p.opt(p.str("Bank account, when method is bank.", 100)),
      branch: p.opt(p.str("Branch.", 100)),
      paidOn: p.opt(p.date("Date paid. Defaults to today.")),
      reference: p.opt(p.str("Payment reference.", 100)),
      note: p.opt(p.str("Note.", 500)),
    }),
    run: async (ctx, a) => {
      const branch = requireBranch(ctx, a.branch);
      if (a.periodFrom > a.periodTo) toolError("VALIDATION", "periodFrom is after periodTo.");
      if (a.method === "bank" && !a.bankAccount) toolError("VALIDATION", "Which bank account? Ask the user.");
      const bank = a.method === "bank" && a.bankAccount ? await findBankAccount(ctx, a.bankAccount) : null;
      notFuture(ctx, a.paidOn, "Date");
      const body = checkBody(taxPaymentSchema, {
        branchId: branch.id,
        periodFrom: a.periodFrom,
        periodTo: a.periodTo,
        amountCents: toCents(a.amountLkr),
        method: a.method,
        bankAccountId: bank?.id,
        paidOn: a.paidOn,
        reference: a.reference,
        note: a.note,
      });
      return draft({
        title: `Pay sales tax ${money(a.amountLkr)} for ${a.periodFrom} to ${a.periodTo}`,
        lines: [
          `Period: ${a.periodFrom} to ${a.periodTo}`,
          `Amount: ${money(a.amountLkr)}`,
          `From: ${bank ? bank.label : `${branch.name} cash drawer`}`,
          `Branch: ${branch.name}`,
          dateLine("Paid on", a.paidOn, ctx.today),
          a.reference ? `Reference: ${a.reference}` : "",
        ],
        method: "POST",
        path: "/api/v1/accounts/tax/payments",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_card_settlement",
    kind: "write",
    perms: MANAGE,
    description: "Propose recording a card acquirer settlement: the gross card takings cleared, the fee withheld, and the net paid into a bank.",
    params: params({
      bankAccount: p.str("Bank account the net was paid into.", 100),
      grossLkr: p.lkr("Gross card takings settled."),
      feeLkr: p.opt(p.num("Fee the acquirer withheld, in LKR. 0 if none.")),
      settledOn: p.opt(p.date("Settlement date. Defaults to today.")),
      acquirerRef: p.opt(p.str("Acquirer batch reference.", 100)),
      note: p.opt(p.str("Note.", 500)),
    }),
    run: async (ctx, a) => {
      const bank = await findBankAccount(ctx, a.bankAccount);
      const fee = a.feeLkr ?? 0;
      if (fee < 0 || fee >= a.grossLkr) toolError("VALIDATION", "The fee must be zero or more and less than the gross.");
      notFuture(ctx, a.settledOn, "Date");
      const body = checkBody(cardSettlementSchema, {
        bankAccountId: bank.id,
        grossCents: toCents(a.grossLkr),
        feeCents: toCents(fee),
        settledOn: a.settledOn,
        acquirerRef: a.acquirerRef,
        note: a.note,
      });
      return draft({
        title: `Card settlement ${money(a.grossLkr)} into ${bank.name}`,
        lines: [
          `Gross cleared from card takings (1020): ${money(a.grossLkr)}`,
          `Fee (6060 Bank & Card Charges): ${formatLkr(toCents(fee))}`,
          `Net into ${bank.label}: ${formatLkr(toCents(a.grossLkr) - toCents(fee))}`,
          dateLine("Settled on", a.settledOn, ctx.today),
          a.acquirerRef ? `Reference: ${a.acquirerRef}` : "",
        ],
        method: "POST",
        path: "/api/v1/card-settlements",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_journal_adjustment",
    kind: "write",
    perms: MANAGE,
    description:
      "Propose a manual journal adjustment (one debit account, one credit account, one amount) with a reason. Use only for corrections no other flow covers; it goes through the approval rules for manual adjustments.",
    params: params({
      debitAccount: p.str("Account to debit (code or name).", 100),
      creditAccount: p.str("Account to credit (code or name).", 100),
      amountLkr: p.lkr("Amount."),
      reason: p.str("Why the correction is needed.", 500),
      memo: p.opt(p.str("Memo on the entry.", 500)),
      branch: p.opt(p.str("Branch the entry belongs to.", 100)),
      entryDate: p.opt(p.date("Entry date. Defaults to today.")),
    }),
    run: async (ctx, a) => {
      const branch = requireBranch(ctx, a.branch);
      const [dr, cr] = await Promise.all([findAccount(ctx, a.debitAccount), findAccount(ctx, a.creditAccount)]);
      if (dr.code === cr.code) toolError("VALIDATION", "Debit and credit accounts must differ.");
      for (const acc of [dr, cr]) if (acc.is_active !== 1) toolError("VALIDATION", `Account ${acc.code} ${acc.name} is inactive.`);
      notFuture(ctx, a.entryDate, "Entry date");
      const body = checkBody(adjustBody, {
        debitAccount: dr.code,
        creditAccount: cr.code,
        amountCents: toCents(a.amountLkr),
        memo: a.memo,
        reason: a.reason,
        branchId: branch.id,
        entryDate: a.entryDate,
      });
      return draft({
        title: `Manual adjustment ${money(a.amountLkr)}: Dr ${dr.code} / Cr ${cr.code}`,
        lines: [
          `Debit: ${dr.code} ${dr.name} — ${money(a.amountLkr)}`,
          `Credit: ${cr.code} ${cr.name} — ${money(a.amountLkr)}`,
          `Branch: ${branch.name}`,
          dateLine("Entry date", a.entryDate, ctx.today),
          `Reason: ${a.reason}`,
          a.memo ? `Memo: ${a.memo}` : "",
          "Manual adjustments may need a second person's approval before they post.",
        ],
        method: "POST",
        path: "/api/v1/accounts/adjustments",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_reverse_entry",
    kind: "write",
    perms: MANAGE,
    description: "Propose reversing a posted journal entry (posts the mirror entry and marks the original REVERSED). Nothing is ever deleted.",
    params: params({
      entry: p.str("Entry number (JE-000123) or id.", 80),
      reason: p.str("Why it is being reversed.", 500),
      entryDate: p.opt(p.date("Date of the reversal. Defaults to today.")),
    }),
    run: async (ctx, a) => {
      const q = a.entry.trim();
      const e = await ctx.db
        .prepare("SELECT id, entry_no, entry_date, memo, status, branch_id FROM journal_entries WHERE id = ? OR entry_no = ?")
        .bind(q, q.toUpperCase())
        .first<{ id: string; entry_no: string; entry_date: string; memo: string | null; status: string; branch_id: string | null }>();
      if (!e || (ctx.scope !== null && e.branch_id && !ctx.scope.includes(e.branch_id)))
        toolError("NOT_FOUND", `No journal entry "${q}" that this user can see.`);
      if (e.status !== "POSTED") toolError("CONFLICT", `${e.entry_no} is ${e.status}; only a posted entry can be reversed.`);
      notFuture(ctx, a.entryDate, "Date");
      const total = await ctx.db
        .prepare("SELECT COALESCE(SUM(debit_cents), 0) AS n FROM journal_lines WHERE entry_id = ?")
        .bind(e.id)
        .first<{ n: number }>();
      const body = checkBody(reverseBody, { entryId: e.id, reason: a.reason, entryDate: a.entryDate });
      return draft({
        title: `Reverse ${e.entry_no}`,
        lines: [
          `Entry: ${e.entry_no} dated ${e.entry_date}${e.memo ? ` — ${e.memo}` : ""}`,
          `Total debits being reversed: ${formatLkr(total?.n ?? 0)}`,
          `Branch: ${branchName(ctx, e.branch_id)}`,
          dateLine("Reversal date", a.entryDate, ctx.today),
          `Reason: ${a.reason}`,
        ],
        method: "POST",
        path: "/api/v1/accounts/journal/reverse",
        body,
      });
    },
  }),

  defineTool({
    name: "propose_day_close",
    kind: "write",
    perms: MANAGE,
    description:
      "Propose closing a branch's business day with the counted cash. Run day_closing first: it only closes when every check passes and nothing is unrecognised, and a difference needs a reason.",
    params: params({
      countedCashLkr: p.num("Cash physically counted in the drawer, in LKR."),
      branch: p.opt(p.str("Branch.", 100)),
      date: p.opt(p.date("The day. Defaults to today.")),
      differenceReason: p.opt(p.str("Explanation, required when counted differs from expected.", 500)),
      cardTerminalLkr: p.opt(p.num("Card terminal end-of-day total, in LKR.")),
      postDifference: p.opt(p.bool("Post the difference to 6090 Cash Short & Over so tomorrow opens with what is really there.")),
    }),
    run: async (ctx, a) => {
      const branch = requireBranch(ctx, a.branch);
      const date = notFuture(ctx, a.date, "Date") ?? ctx.today;
      if (a.countedCashLkr < 0) toolError("VALIDATION", "Counted cash cannot be negative.");
      const body = checkBody(closeDaySchema, {
        branchId: branch.id,
        date,
        actualCents: toCents(a.countedCashLkr),
        differenceReason: a.differenceReason,
        cardTerminalCents: a.cardTerminalLkr === undefined ? undefined : toCents(a.cardTerminalLkr),
        postDifference: a.postDifference,
      });
      return draft({
        title: `Close ${branch.name} for ${date}`,
        lines: [
          `Branch: ${branch.name}`,
          `Day: ${date}`,
          `Counted cash: ${formatLkr(toCents(a.countedCashLkr))}`,
          a.cardTerminalLkr !== undefined ? `Card terminal total: ${formatLkr(toCents(a.cardTerminalLkr))}` : "",
          a.differenceReason ? `Difference reason: ${a.differenceReason}` : "",
          a.postDifference ? "The difference will be posted to 6090 Cash Short & Over." : "",
          "A closed day rejects new postings until it is reopened by a second person.",
        ],
        method: "POST",
        path: "/api/v1/day-closings",
        body,
      });
    },
  }),
];
