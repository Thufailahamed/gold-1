import { PERMISSIONS } from "@goldos/shared";
import { listBankAccounts, listTransfers } from "../../services/cashbank";
import { buildClosingReport, listClosings } from "../../services/dayclose";
import { investigateDay, listUnclosedDays, varianceReport } from "../../services/dayreports";
import { expenseSummary, expenseThresholdsFor, listExpenseCategories, listExpenses } from "../../services/expenses";
import { listFiscalYears } from "../../services/fiscal";
import { goldStock } from "../../services/gold";
import {
  accountStatement,
  getJournalEntry,
  listAccounts,
  listJournalEntries,
  partyLedger,
  trialBalance,
} from "../../services/journal";
import { listPayables, supplierOpenInvoices } from "../../services/payables";
import { purchaseSummary } from "../../services/purchases";
import { currentGoldRates } from "../../services/rates";
import { customerOpenInvoices, listReceivables } from "../../services/receipts";
import { reconcile } from "../../services/reconcile";
import { balanceSheet, dailyCashSummary, profitAndLoss } from "../../services/statements";
import { getTaxConfig, taxReport } from "../../services/taxes";
import { evaluate } from "../calc";
import { ACCOUNTS_READ, branchLabel, readBranch, requireBranch, toolError, type AssistantContext } from "../context";
import { capRows, formatGrams, formatLkr } from "../present";
import { localDayBoundsMs, PERIODS, resolvePeriod } from "../time";
import { asOfDate, branchField, defineTool, p, params, periodFields, rangeOf, type AnyTool } from "./kit";
import { branchName, findAccount, findDocument, findParty } from "./lookup";

const ANYONE: readonly string[] = [];
const bid = (b: { id: string } | null) => b?.id;

const all = async <T>(db: D1Database, sql: string, vals: unknown[]): Promise<T[]> =>
  ((await db.prepare(sql).bind(...vals).all<T>()).results ?? []) as T[];

/** Every read result says what it covers, so the answer can say it too. */
const scoped = (ctx: AssistantContext, b: { id: string; name: string; code: string } | null, extra: Record<string, unknown>) => ({
  scope: branchLabel(ctx, b),
  ...extra,
});

export const readTools: AnyTool[] = [
  defineTool({
    name: "resolve_period",
    kind: "read",
    perms: ANYONE,
    description:
      "Turn a named period into exact dates using the shop's calendar and financial year. Use it whenever the user names a relative period and you need the dates themselves (most report tools also accept 'period' directly).",
    params: params({
      period: p.enm(PERIODS, "The named period."),
      month: p.opt(p.int("Month 1-12 for period 'month'.", 1, 12)),
      quarter: p.opt(p.int("Calendar quarter 1-4 for period 'quarter' (1 = Jan-Mar).", 1, 4)),
      year: p.opt(p.int("Year for period 'month' or 'quarter'.", 2000, 2100)),
      date: p.opt(p.date("Any date inside the financial year, for 'fiscal_year_of'.")),
    }),
    run: async (ctx, a) => resolvePeriod(a.period, ctx.today, ctx.fiscalStartMonth, a),
  }),

  defineTool({
    name: "calculate",
    kind: "read",
    perms: ANYONE,
    description:
      "Exact arithmetic. ALWAYS use this for any sum, difference, percentage, ratio or average you state that a tool did not already return. Supports + - * / % ( ), sum(), avg(), min(), max(), abs(), round(x, places). Amounts like 'LKR 1,234.50' may be pasted in as-is.",
    params: params({
      expression: p.str("The arithmetic expression, e.g. '(1250000.00 - 980000.00) / 1250000.00 * 100'.", 2000),
    }),
    run: async (_ctx, a) => {
      try {
        return { expression: a.expression, result: evaluate(a.expression) };
      } catch (err) {
        return toolError("VALIDATION", `Could not calculate: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  }),

  defineTool({
    name: "list_branches",
    kind: "read",
    perms: ANYONE,
    description: "The branches this user can see, with which one is selected in the app.",
    params: params({}),
    run: async (ctx) => ({
      shopWideAccess: ctx.scope === null,
      selectedBranch: ctx.branches.find((b) => b.id === ctx.selectedBranchId)?.name ?? null,
      branches: ctx.branches,
    }),
  }),

  defineTool({
    name: "chart_of_accounts",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "Every ledger account (code, name, type, active) with its all-time balance to date. The balance is debit minus credit for every account, so liability, equity and revenue balances show as negative; use account_balance for a balance on the account's normal side. Use to find an account code by name.",
    params: params({ branch: branchField }),
    run: async (ctx, a) => {
      const b = readBranch(ctx, a.branch);
      const rows = await listAccounts(ctx.db, bid(b));
      return scoped(ctx, b, {
        accounts: rows.map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type,
          active: r.is_active === 1,
          balance_cents: r.balance_cents,
          entries: r.entry_count,
        })),
      });
    },
  }),

  defineTool({
    name: "account_balance",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "Balance of one ledger account as at a date (end of that day). Debit-normal accounts (assets, expenses) show debit minus credit; credit-normal (liabilities, equity, revenue) show credit minus debit.",
    params: params({
      account: p.str("Account code (e.g. 1000) or name (e.g. 'Cash').", 100),
      date: p.opt(p.date("As-at date. Defaults to today.")),
      branch: branchField,
    }),
    run: async (ctx, a) => {
      const acc = await findAccount(ctx, a.account);
      const date = asOfDate(ctx, a.date);
      const b = readBranch(ctx, a.branch);
      const rows = await trialBalance(ctx.db, { date, branchId: bid(b) });
      const row = rows.find((r) => r.code === acc.code);
      const debit = row?.debitCents ?? 0;
      const credit = row?.creditCents ?? 0;
      const creditNormal = ["LIABILITY", "EQUITY", "REVENUE"].includes(acc.type);
      return scoped(ctx, b, {
        account: `${acc.code} ${acc.name}`,
        type: acc.type,
        asOf: date,
        totalDebits_cents: debit,
        totalCredits_cents: credit,
        balance_cents: creditNormal ? credit - debit : debit - credit,
        normalSide: creditNormal ? "credit" : "debit",
      });
    },
  }),

  defineTool({
    name: "trial_balance",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Trial balance as at a date: every account with movement, its debits, credits and balance, and whether the books balance.",
    params: params({ date: p.opt(p.date("As-at date. Defaults to today.")), branch: branchField }),
    run: async (ctx, a) => {
      const date = asOfDate(ctx, a.date);
      const b = readBranch(ctx, a.branch);
      const rows = (await trialBalance(ctx.db, { date, branchId: bid(b) })).filter((r) => r.debitCents !== 0 || r.creditCents !== 0);
      const dr = rows.reduce((s, r) => s + r.debitCents, 0);
      const cr = rows.reduce((s, r) => s + r.creditCents, 0);
      return scoped(ctx, b, {
        asOf: date,
        accounts: rows,
        totalDebits_cents: dr,
        totalCredits_cents: cr,
        balanced: dr === cr,
      });
    },
  }),

  defineTool({
    name: "profit_and_loss",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Profit and loss statement from the ledger for a period: revenue, cost of sales, gross profit, operating expenses by account, net profit.",
    params: params({ ...periodFields, branch: branchField }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a);
      const b = readBranch(ctx, a.branch);
      const pnl = await profitAndLoss(ctx.db, { from: r.from, to: r.to, branchId: bid(b) });
      return scoped(ctx, b, { period: r.label, ...pnl, branchId: undefined });
    },
  }),

  defineTool({
    name: "balance_sheet",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Balance sheet as at a date: assets, liabilities, equity (retained earnings and current-year profit), and whether it balances.",
    params: params({ date: p.opt(p.date("As-at date. Defaults to today.")), branch: branchField }),
    run: async (ctx, a) => {
      const date = asOfDate(ctx, a.date);
      const b = readBranch(ctx, a.branch);
      return scoped(ctx, b, { ...(await balanceSheet(ctx.db, { date, branchId: bid(b) })), branchId: undefined });
    },
  }),

  defineTool({
    name: "account_statement",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "Ledger of one account over a period: opening balance, each entry with running balance, closing balance. Balances here are debit minus credit, so a liability, equity or revenue account normally shows negative figures.",
    params: params({ account: p.str("Account code or name.", 100), ...periodFields, branch: branchField }),
    run: async (ctx, a) => {
      const acc = await findAccount(ctx, a.account);
      const r = rangeOf(ctx, a);
      const b = readBranch(ctx, a.branch);
      const st = await accountStatement(ctx.db, { code: acc.code, from: r.from, to: r.to, branchId: bid(b) });
      const MAX = 60;
      return scoped(ctx, b, {
        account: `${acc.code} ${acc.name}`,
        period: r.label,
        opening_cents: st.opening,
        closing_cents: st.closing,
        entryCount: st.rows.length,
        entries: st.rows.length > MAX ? st.rows.slice(-MAX) : st.rows,
        note: st.rows.length > MAX ? `Only the latest ${MAX} of ${st.rows.length} entries are listed; opening and closing are complete.` : undefined,
      });
    },
  }),

  defineTool({
    name: "journal_entries",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "List journal entries in a period, optionally only those touching one account or from one source (ref_entity such as sale_invoice, expense, purchase_payment).",
    params: params({
      ...periodFields,
      account: p.opt(p.str("Only entries with a line on this account (code or name).", 100)),
      refEntity: p.opt(p.str("Only entries from this source, e.g. 'expense', 'sale_invoice', 'manual_adjustment'.", 60)),
      branch: branchField,
      limit: p.opt(p.int("How many, newest first. Default 25.", 1, 50)),
    }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a);
      const b = readBranch(ctx, a.branch);
      const acc = a.account ? await findAccount(ctx, a.account) : null;
      const data = await listJournalEntries(ctx.db, {
        page: 1,
        limit: a.limit ?? 25,
        from: r.from,
        to: r.to,
        branchId: bid(b),
        accountCode: acc?.code,
        refEntity: a.refEntity,
      });
      return scoped(ctx, b, {
        period: r.label,
        account: acc ? `${acc.code} ${acc.name}` : undefined,
        totalMatching: data.total,
        shown: data.rows.length,
        entries: data.rows.map((e) => ({ ...e, branch: branchName(ctx, e.branchId), branchId: undefined, createdBy: undefined })),
      });
    },
  }),

  defineTool({
    name: "journal_entry",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "One journal entry with all its lines, by entry number (e.g. JE-000123) or id.",
    params: params({ entry: p.str("Entry number like JE-000123, or its id.", 80) }),
    run: async (ctx, a) => {
      const q = a.entry.trim();
      const row = await ctx.db
        .prepare("SELECT id, branch_id FROM journal_entries WHERE id = ? OR entry_no = ? OR entry_no = ?")
        .bind(q, q.toUpperCase(), /^\d+$/.test(q) ? `JE-${q.padStart(6, "0")}` : q)
        .first<{ id: string; branch_id: string | null }>();
      if (!row || (ctx.scope !== null && row.branch_id && !ctx.scope.includes(row.branch_id)))
        toolError("NOT_FOUND", `No journal entry "${q}" that this user can see.`);
      const e = await getJournalEntry(ctx.db, row.id);
      return { ...e, branch: branchName(ctx, e.branchId), branchId: undefined };
    },
  }),

  defineTool({
    name: "cash_position",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "Where the money is right now: cash in hand (1000) per branch, card takings not yet settled (1020), cash in transit between branches (1030), and every bank account balance.",
    params: params({ branch: branchField }),
    run: async (ctx, a) => {
      const b = readBranch(ctx, a.branch);
      const branches = b ? [b] : ctx.branches;
      const byBranch = await all<{ branch_id: string; code: string; bal: number }>(
        ctx.db,
        `SELECT e.branch_id, l.account_code AS code, COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS bal
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_code IN ('1000', '1020', '1030')
         GROUP BY e.branch_id, l.account_code`,
        []
      );
      const bal = (branchId: string, code: string) => byBranch.find((r) => r.branch_id === branchId && r.code === code)?.bal ?? 0;
      const banks = await listBankAccounts(ctx.db, { branchId: bid(b) });
      const visibleBanks = banks.filter((k) => ctx.scope === null || k.branch_id === null || ctx.scope.includes(k.branch_id));
      const transit = b ? null : byBranch.filter((r) => r.code === "1030").reduce((s, r) => s + r.bal, 0);
      return scoped(ctx, b, {
        asOf: `${ctx.today} ${ctx.clock.time}`,
        branches: branches.map((br) => ({
          branch: br.name,
          cashInHand_cents: bal(br.id, "1000"),
          cardNotYetSettled_cents: bal(br.id, "1020"),
        })),
        cashInTransitBetweenBranches_cents: transit ?? undefined,
        bankAccounts: visibleBanks.map((k) => ({
          name: k.name,
          bank: k.bank_name,
          accountCode: k.account_code,
          branch: k.branch_id ? branchName(ctx, k.branch_id) : "shop-wide",
          active: k.is_active === 1,
          balance_cents: k.balance_cents,
        })),
        note: "Cash in hand is what the ledger says; expenses awaiting approval have left the drawer but are not yet in the ledger.",
      });
    },
  }),

  defineTool({
    name: "daily_cash_summary",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "Money in and out per day over a period, across the cash drawer (1000) and every bank account together. Moves between drawer and bank (deposits, withdrawals) are left out. For the drawer alone use account_statement on 1000.",
    params: params({ ...periodFields, branch: branchField }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a, "last_7_days");
      const b = readBranch(ctx, a.branch);
      const days = await dailyCashSummary(ctx.db, { from: r.from, to: r.to, branchId: bid(b) });
      return scoped(ctx, b, {
        period: r.label,
        days: days.map((d) => ({ ...d, net_cents: d.inCents - d.outCents })),
        totalIn_cents: days.reduce((s, d) => s + d.inCents, 0),
        totalOut_cents: days.reduce((s, d) => s + d.outCents, 0),
      });
    },
  }),

  defineTool({
    name: "cash_transfers",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Cash transfers between branches; status IN_TRANSIT means dispatched but not yet received; COMPLETE means received.",
    params: params({ status: p.opt(p.enm(["IN_TRANSIT", "COMPLETE"], "Filter by status.")), branch: branchField }),
    run: async (ctx, a) => {
      const b = readBranch(ctx, a.branch);
      const data = await listTransfers(ctx.db, { status: a.status, branchId: bid(b) });
      const rows = data.rows.filter((t) => ctx.scope === null || ctx.scope.includes(t.from_branch_id) || ctx.scope.includes(t.to_branch_id));
      const cut = capRows(rows, 40);
      return scoped(ctx, b, {
        total: rows.length,
        shown: cut.rows.length,
        note: cut.truncated ? `Only the latest ${cut.rows.length} of ${rows.length} transfers are listed.` : undefined,
        transfers: cut.rows.map((t) => ({
          ...t,
          from: branchName(ctx, t.from_branch_id),
          to: branchName(ctx, t.to_branch_id),
          from_branch_id: undefined,
          to_branch_id: undefined,
          from_entry_id: undefined,
          to_entry_id: undefined,
        })),
      });
    },
  }),

  defineTool({
    name: "receivables",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "Customer dues as at today: who owes the shop, how much, oldest open invoice, and aging buckets (0-30, 31-60, 61-90, 90+ days). Only current balances; for the receivables total on a past date use account_balance on 1200.",
    params: params({
      asOf: p.opt(p.date("Must be today if given; past dates are not supported here.")),
      branch: branchField,
      limit: p.opt(p.int("How many customers, largest balance first. Default 25.", 1, 100)),
    }),
    run: async (ctx, a) => {
      const asOf = currentOnly(ctx, a.asOf, "1200");
      const b = readBranch(ctx, a.branch);
      const d = await listReceivables(ctx.db, { asOf, branchId: bid(b) });
      const rows = [...d.rows].sort((x, y) => y.balanceCents - x.balanceCents);
      const cut = capRows(rows, a.limit ?? 25);
      return scoped(ctx, b, {
        asOf,
        total_cents: d.totalCents,
        customersOwing: rows.length,
        aging_cents: d.aging,
        customers: cut.rows.map((r) => ({ ...r, aging_cents: r.aging, aging: undefined })),
        note: cut.truncated ? `Showing the ${cut.rows.length} largest of ${cut.totalRows}; the total covers all.` : undefined,
      });
    },
  }),

  defineTool({
    name: "customer_account",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "One customer's account: balance owed, ledger totals, and each open invoice. Find the customer by name, code, phone or id.",
    params: params({ customer: p.str("Customer name, code, phone or id.", 120), branch: branchField }),
    run: async (ctx, a) => {
      const c = await findParty(ctx, "customers", a.customer);
      const b = readBranch(ctx, a.branch);
      const [ledger, open] = await Promise.all([
        partyLedger(ctx.db, "customer", c.id, { branchId: bid(b) }),
        customerOpenInvoices(ctx.db, c.id, bid(b)),
      ]);
      return scoped(ctx, b, {
        customer: { id: c.id, name: c.name, code: c.code, phone: c.phone, homeBranch: branchName(ctx, c.branch_id) },
        owes_cents: ledger.totals.closing,
        totals_cents: ledger.totals,
        openInvoices: open.invoices,
        recentLedger: ledger.lines.slice(-15),
      });
    },
  }),

  defineTool({
    name: "payables",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "What the shop owes suppliers as at today: balance per supplier, oldest unpaid invoice, aging buckets. Only current balances; for the payables total on a past date use account_balance on 2000.",
    params: params({
      asOf: p.opt(p.date("Must be today if given; past dates are not supported here.")),
      branch: branchField,
      limit: p.opt(p.int("How many suppliers, largest first. Default 25.", 1, 100)),
    }),
    run: async (ctx, a) => {
      const asOf = currentOnly(ctx, a.asOf, "2000");
      const b = readBranch(ctx, a.branch);
      const d = await listPayables(ctx.db, { asOf, branchId: bid(b) });
      const rows = [...d.rows].sort((x, y) => y.balanceCents - x.balanceCents);
      const cut = capRows(rows, a.limit ?? 25);
      return scoped(ctx, b, {
        asOf,
        total_cents: d.totalCents,
        suppliersOwed: rows.length,
        aging_cents: d.aging,
        suppliers: cut.rows.map((r) => ({ ...r, aging_cents: r.aging, aging: undefined })),
        note: cut.truncated ? `Showing the ${cut.rows.length} largest of ${cut.totalRows}; the total covers all.` : undefined,
      });
    },
  }),

  defineTool({
    name: "supplier_account",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "One supplier's account: what the shop owes them, ledger totals, and each unpaid purchase invoice (with its number, needed to pay it).",
    params: params({ supplier: p.str("Supplier name, code, phone or id.", 120), branch: branchField }),
    run: async (ctx, a) => {
      const s = await findParty(ctx, "suppliers", a.supplier);
      const b = readBranch(ctx, a.branch);
      const [ledger, open] = await Promise.all([
        partyLedger(ctx.db, "supplier", s.id, { branchId: bid(b) }),
        supplierOpenInvoices(ctx.db, s.id, bid(b)),
      ]);
      return scoped(ctx, b, {
        supplier: { id: s.id, name: s.name, code: s.code, phone: s.phone },
        owed_cents: ledger.totals.closing,
        totals_cents: ledger.totals,
        unpaidInvoices: open.invoices,
        unpaidTotal_cents: open.totalCents,
        recentLedger: ledger.lines.slice(-15),
      });
    },
  }),

  defineTool({
    name: "expenses",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Expenses in a period, newest first, with status (POSTED, PENDING_APPROVAL, REJECTED).",
    params: params({
      ...periodFields,
      status: p.opt(p.enm(["POSTED", "PENDING_APPROVAL", "REJECTED"], "Filter by status.")),
      category: p.opt(p.str("Category name or id.", 100)),
      branch: branchField,
      limit: p.opt(p.int("How many. Default 25.", 1, 100)),
    }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a);
      const b = readBranch(ctx, a.branch);
      let categoryId: string | undefined;
      if (a.category) {
        const cats = await listExpenseCategories(ctx.db);
        const q = a.category.toLowerCase();
        const hit = cats.find((c) => c.id === a.category || c.name.toLowerCase() === q) ?? cats.find((c) => c.name.toLowerCase().includes(q));
        if (!hit) toolError("NOT_FOUND", `No expense category "${a.category}". Categories: ${cats.map((c) => c.name).join(", ")}`);
        categoryId = hit.id;
      }
      const d = await listExpenses(ctx.db, { page: 1, limit: a.limit ?? 25, from: r.from, to: r.to, branchId: bid(b), status: a.status, categoryId });
      return scoped(ctx, b, {
        period: r.label,
        totalMatching: d.total,
        shown: d.rows.length,
        expenses: d.rows.map((e) => ({
          number: e.number,
          id: e.id,
          date: e.incurred_on,
          category: e.category_name,
          amount_cents: e.amount_cents,
          description: e.description,
          vendor: e.vendor,
          status: e.status,
          branch: branchName(ctx, e.branch_id),
          hasReceipt: !!e.receipt_key,
          rejectionReason: e.rejection_reason ?? undefined,
        })),
      });
    },
  }),

  defineTool({
    name: "expense_summary",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Expense totals for a period by category: posted, awaiting approval, rejected. Also the approval and receipt thresholds.",
    params: params({ ...periodFields, branch: branchField }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a);
      const b = readBranch(ctx, a.branch);
      const [s, t] = await Promise.all([expenseSummary(ctx.db, { from: r.from, to: r.to, branchId: bid(b) }), expenseThresholdsFor(ctx.db)]);
      return scoped(ctx, b, { period: r.label, ...s, thresholds: t });
    },
  }),

  defineTool({
    name: "expense_categories",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Expense categories and the ledger account each posts to.",
    params: params({}),
    run: async (ctx) => ({
      categories: (await listExpenseCategories(ctx.db)).map((c) => ({ id: c.id, name: c.name, account: c.account_code, active: c.is_active === 1 })),
    }),
  }),

  defineTool({
    name: "day_closing",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "The day-closing screen for one branch and date: opening cash, cash in/out by type, expected closing cash, sales/purchases/expenses, card takings, gold balance, reconciliation checks, expenses awaiting approval, and whether the day is already closed.",
    params: params({ branch: branchField, date: p.opt(p.date("The business day. Defaults to today.")) }),
    run: async (ctx, a) => {
      const b = requireBranch(ctx, a.branch);
      const date = asOfDate(ctx, a.date);
      const [report, closed] = await Promise.all([
        buildClosingReport(ctx.db, { branchId: b.id, date }),
        ctx.db
          .prepare("SELECT status, actual_cents, difference_cents, difference_reason, closed_at FROM day_closings WHERE branch_id = ? AND close_date = ?")
          .bind(b.id, date)
          .first<{ status: string; actual_cents: number; difference_cents: number; difference_reason: string | null; closed_at: number }>(),
      ]);
      return {
        ...report,
        branchId: undefined,
        branch: b.name,
        dayStatus: closed?.status ?? "NOT_CLOSED",
        closedCount: closed ? { counted_cents: closed.actual_cents, difference_cents: closed.difference_cents, reason: closed.difference_reason, closed_at: closed.closed_at } : undefined,
      };
    },
  }),

  defineTool({
    name: "investigate_cash_difference",
    kind: "read",
    perms: ACCOUNTS_READ,
    description:
      "Find where a cash difference came from on one branch and day: failing checks, documents not posted as they say, every drawer movement with who keyed it, pending expenses/transfers/approvals, late entries, and single movements or pairs exactly the size of the difference. Pass the counted cash if known.",
    params: params({
      branch: branchField,
      date: p.opt(p.date("The business day. Defaults to today.")),
      countedCashLkr: p.opt(p.num("Cash physically counted, in LKR.")),
    }),
    run: async (ctx, a) => {
      const b = requireBranch(ctx, a.branch);
      const date = asOfDate(ctx, a.date);
      const inv = await investigateDay(ctx.db, {
        branchId: b.id,
        date,
        actualCents: a.countedCashLkr === undefined ? undefined : Math.round(a.countedCashLkr * 100),
      });
      return {
        ...inv,
        branch: b.name,
        branchId: undefined,
        failingChecks: inv.failingChecks.map((c) => checkView(c)),
        cashMovements: capRows(inv.cashMovements, 60).rows,
      };
    },
  }),

  defineTool({
    name: "unclosed_days",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Days with activity that nobody closed (or reopened and not re-closed) for a branch.",
    params: params({ branch: branchField, ...periodFields }),
    run: async (ctx, a) => {
      const b = requireBranch(ctx, a.branch);
      const r = rangeOf(ctx, a, "last_30_days");
      return { branch: b.name, period: r.label, days: await listUnclosedDays(ctx.db, { branchId: b.id, from: r.from, to: r.to }) };
    },
  }),

  defineTool({
    name: "day_closings",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Past day closings with expected vs counted cash and the difference; plus the shortage/overage variance summary.",
    params: params({ ...periodFields, branch: branchField }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a, "last_30_days");
      const b = readBranch(ctx, a.branch);
      const [list, variance] = await Promise.all([
        listClosings(ctx.db, { page: 1, limit: 60, from: r.from, to: r.to, branchId: bid(b) }),
        varianceReport(ctx.db, { from: r.from, to: r.to, branchId: bid(b) }),
      ]);
      const rows = list.rows.filter((c) => ctx.scope === null || ctx.scope.includes(c.branch_id));
      return scoped(ctx, b, {
        period: r.label,
        closings: rows.map((c) => ({
          date: c.close_date,
          branch: branchName(ctx, c.branch_id),
          status: c.status,
          expected_cents: c.expected_cents,
          counted_cents: c.actual_cents,
          difference_cents: c.difference_cents,
          reason: c.difference_reason,
        })),
        variance,
      });
    },
  }),

  defineTool({
    name: "reconciliation",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Run the reconciliation checks for a date (trial balance nets to zero, sales/purchases/payments/expenses/tax cross-foot, gold ledger vs stock, card clearing, cash in transit).",
    params: params({ date: p.opt(p.date("Defaults to today.")), branch: branchField }),
    run: async (ctx, a) => {
      const date = asOfDate(ctx, a.date);
      const b = readBranch(ctx, a.branch);
      const rep = await reconcile(ctx.db, { date, branchId: bid(b) });
      return scoped(ctx, b, {
        date,
        allPassed: rep.passed,
        failing: rep.checks.filter((c) => !c.pass).length,
        checks: rep.checks.map((c) => checkView(c)),
      });
    },
  }),

  defineTool({
    name: "vat_report",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Sales tax (VAT) return for a period: rate, opening liability, tax charged, refunded, paid, closing amount due, taxable sales.",
    params: params({ ...periodFields, branch: branchField }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a);
      const b = readBranch(ctx, a.branch);
      const rep = await taxReport(ctx.db, { from: r.from, to: r.to, branchId: bid(b) });
      return scoped(ctx, b, { period: r.label, ...rep, byDay: undefined, branchId: undefined });
    },
  }),

  defineTool({
    name: "tax_settings",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "The configured sales tax rate, label and registration number.",
    params: params({}),
    run: async (ctx) => getTaxConfig(ctx.db),
  }),

  defineTool({
    name: "sales_summary",
    kind: "read",
    perms: [PERMISSIONS.SALES_VIEW],
    description:
      "Sales invoices in a period (shop-local days): count, gross value incl. tax, tax, discounts, amount still unpaid, gold sold, voided count. For revenue as booked, use profit_and_loss.",
    params: params({ ...periodFields, branch: branchField }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a, "today");
      const b = readBranch(ctx, a.branch);
      const { from, to } = localDayBoundsMs(r.from, r.to, ctx.offsetMinutes);
      const bSql = b ? " AND i.branch_id = ?" : "";
      const vals = [from, to, ...(b ? [b.id] : [])];
      const head = await ctx.db
        .prepare(
          `SELECT
             SUM(CASE WHEN i.status <> 'VOID' THEN 1 ELSE 0 END) AS invoices,
             SUM(CASE WHEN i.status = 'VOID' THEN 1 ELSE 0 END) AS voided,
             COALESCE(SUM(CASE WHEN i.status <> 'VOID' THEN i.total_cents ELSE 0 END), 0) AS gross_cents,
             COALESCE(SUM(CASE WHEN i.status <> 'VOID' THEN i.tax_cents ELSE 0 END), 0) AS tax_cents,
             COALESCE(SUM(CASE WHEN i.status <> 'VOID' THEN i.discount_cents ELSE 0 END), 0) AS discount_cents,
             COALESCE(SUM(CASE WHEN i.status <> 'VOID' THEN i.total_cents - i.paid_cents ELSE 0 END), 0) AS unpaid_cents
           FROM sales_invoices i WHERE i.created_at >= ? AND i.created_at <= ?${bSql}`
        )
        .bind(...vals)
        .first<Record<string, number | null>>();
      const gold = await ctx.db
        .prepare(
          `SELECT COALESCE(SUM(p.net_mg), 0) AS net_mg FROM sales_items it
           JOIN sales_invoices i ON i.id = it.invoice_id JOIN products p ON p.id = it.product_id
           WHERE i.status <> 'VOID' AND i.created_at >= ? AND i.created_at <= ?${bSql}`
        )
        .bind(...vals)
        .first<{ net_mg: number }>();
      return scoped(ctx, b, {
        period: r.label,
        invoices: head?.invoices ?? 0,
        voidedInvoices: head?.voided ?? 0,
        grossValue_cents: head?.gross_cents ?? 0,
        tax_cents: head?.tax_cents ?? 0,
        discounts_cents: head?.discount_cents ?? 0,
        stillUnpaid_cents: head?.unpaid_cents ?? 0,
        goldSoldNet_mg: gold?.net_mg ?? 0,
      });
    },
  }),

  defineTool({
    name: "purchase_summary",
    kind: "read",
    perms: [PERMISSIONS.PURCHASES_VIEW],
    description: "Purchase invoices in a period (shop-local days, excluding voided): count, value, paid, outstanding, gold weight.",
    params: params({ ...periodFields, supplier: p.opt(p.str("Only this supplier (name, code or id).", 120)), branch: branchField }),
    run: async (ctx, a) => {
      const r = rangeOf(ctx, a);
      const b = readBranch(ctx, a.branch);
      const s = a.supplier ? await findParty(ctx, "suppliers", a.supplier) : null;
      const { from, to } = localDayBoundsMs(r.from, r.to, ctx.offsetMinutes);
      const sum = await purchaseSummary(ctx.db, { from, to, branchId: bid(b), supplierId: s?.id });
      return scoped(ctx, b, { period: r.label, supplier: s?.name, ...sum });
    },
  }),

  defineTool({
    name: "gold_rates",
    kind: "read",
    perms: [...ACCOUNTS_READ, PERMISSIONS.MASTERS_VIEW, PERMISSIONS.SALES_VIEW],
    description: "Today's gold board rate per gram for each karat, and when each was set.",
    params: params({}),
    run: async (ctx) => ({
      rates: (await currentGoldRates(ctx.db)).map((r) => ({
        karat: r.karat,
        ratePerGram: formatLkr(Math.round(r.rate_per_gram * 100)),
        effective_from_at: r.effective_from,
      })),
    }),
  }),

  defineTool({
    name: "gold_stock",
    kind: "read",
    perms: [PERMISSIONS.GOLD_VIEW],
    description:
      "Fine gold held now, grouped by purity, by branch, or by stage (old gold, melting, refined, for sale). Purity and stage are whole-shop totals; group by branch for one branch's figure.",
    params: params({ groupBy: p.enm(["purity", "branch", "stage"], "How to group the stock.") }),
    run: async (ctx, a) => {
      const stock = (await goldStock(ctx.db, a.groupBy)) as Record<string, unknown>;
      if (a.groupBy !== "branch") return { scope: "whole shop (all branches)", groupBy: a.groupBy, stock };
      // Rows carry raw branch ids: name them, and show a branch-limited user only their own.
      const rows = (stock.byBranch as { branch_id: string | null; fine_mg: number }[]) ?? [];
      return {
        groupBy: a.groupBy,
        byBranch: rows
          .filter((r) => ctx.scope === null || (r.branch_id !== null && ctx.scope.includes(r.branch_id)))
          .map((r) => ({ branch: r.branch_id ? branchName(ctx, r.branch_id) : "no branch", fine_mg: r.fine_mg })),
      };
    },
  }),

  defineTool({
    name: "financial_years",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "The financial years, which are closed, and the current one.",
    params: params({}),
    run: async (ctx) => {
      const d = await listFiscalYears(ctx.db);
      return {
        startMonth: d.startMonth,
        current: d.current,
        years: d.years.map((y) => ({ ...y, close: y.close ? { status: (y.close as { status?: string }).status ?? "CLOSED" } : null })),
      };
    },
  }),

  defineTool({
    name: "find_document",
    kind: "read",
    perms: ACCOUNTS_READ,
    description: "Look up a sales invoice, purchase invoice, expense, receipt or cash transfer by its printed number.",
    params: params({
      type: p.enm(["sales_invoice", "purchase_invoice", "expense", "customer_receipt", "cash_transfer"], "Document type."),
      number: p.str("Its number or id.", 80),
    }),
    run: async (ctx, a) => {
      const map = {
        sales_invoice: ["sales_invoices", "id, number, customer_id, total_cents, paid_cents, tax_cents, status, created_at", "branch_id"],
        purchase_invoice: ["purchase_invoices", "id, number, supplier_id, total_cents, paid_cents, status, created_at", "branch_id"],
        expense: ["expenses", "id, number, incurred_on, amount_cents, description, vendor, status, created_at", "branch_id"],
        customer_receipt: ["customer_receipts", "id, number, customer_id, amount_cents, method, receipt_date, status, created_at", "branch_id"],
        cash_transfer: ["cash_transfers", "id, number, to_branch_id, amount_cents, sent_on, received_on, status, reason", "from_branch_id"],
      } as const;
      const [table, cols, branchCol] = map[a.type];
      const doc = await findDocument<{ id: string; number: string; branch_id: string } & Record<string, unknown>>(
        ctx,
        a.type.replace("_", " "),
        table,
        cols,
        a.number,
        branchCol
      );
      return { type: a.type, ...doc, branch: branchName(ctx, doc.branch_id), branch_id: undefined };
    },
  }),
];

/**
 * The receivables and payables lists sum the ledger to date whatever date is
 * asked; only the aging uses it. A past date would label today's balances as
 * that day's, so it is refused with the tool that can answer it.
 */
function currentOnly(ctx: AssistantContext, d: string | undefined, controlAccount: string): string {
  const date = asOfDate(ctx, d);
  if (date !== ctx.today)
    toolError(
      "VALIDATION",
      `This list only shows balances as at today (${ctx.today}). For the total on ${date}, call account_balance with account ${controlAccount} and that date.`
    );
  return date;
}

/** Reconciliation figures are cents, except the gold checks, which are milligrams. */
function checkView(c: { id: string; label: string; expected: number; actual: number; difference: number; detail: string[]; pass?: boolean; scope?: string }) {
  const fmt = c.id.startsWith("gold_") ? formatGrams : formatLkr;
  return {
    check: c.id,
    label: c.label,
    passed: c.pass,
    expected: fmt(c.expected),
    actual: fmt(c.actual),
    difference: fmt(c.difference),
    detail: c.detail.slice(0, 10),
  };
}
