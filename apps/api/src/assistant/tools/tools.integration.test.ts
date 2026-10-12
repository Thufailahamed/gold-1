// Every assistant tool against the real schema: no tool may fail with a
// server error (a wrong column, a bad join) — only with the deliberate,
// model-readable errors (not found, ambiguous, validation).
import { PERMISSIONS } from "@goldos/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "../../services/sqlite-test-db";
import { buildContext, type AssistantContext } from "../context";
import { ALL_TOOLS, runTool } from "./index";

const ARGS: Record<string, Record<string, unknown>> = {
  resolve_period: { period: "last_month" },
  calculate: { expression: "1 + 1" },
  account_balance: { account: "Cash on Hand" },
  account_statement: { account: "1000", period: "this_month" },
  journal_entries: { period: "this_fiscal_year", account: "1000" },
  journal_entry: { entry: "JE-000001" },
  customer_account: { customer: "Nimal" },
  supplier_account: { supplier: "Gold Supplies" },
  expenses: { period: "this_month", status: "POSTED" },
  day_closing: { branch: "Main" },
  investigate_cash_difference: { branch: "Main", countedCashLkr: 99000 },
  unclosed_days: { branch: "Main" },
  gold_stock: { groupBy: "stage" },
  purchase_summary: { period: "this_month", supplier: "Gold Supplies" },
  find_document: { type: "purchase_invoice", number: "PI-1" },
  propose_expense: { category: "Utilities", amountLkr: 1200, description: "Electricity", paidFrom: "cash", branch: "Main" },
  propose_expense_decision: { expense: "EXP-1", decision: "approve" },
  propose_cash_entry: { kind: "OWNER_CAPITAL", amountLkr: 10, method: "cash", note: "x", branch: "Main" },
  propose_bank_deposit_or_withdrawal: { direction: "deposit", bankAccount: "HNB", amountLkr: 10, branch: "Main" },
  propose_cash_transfer: { fromBranch: "Main", toBranch: "City", amountLkr: 10, reason: "float" },
  propose_receive_cash_transfer: { transfer: "CT-1" },
  propose_customer_receipt: { customer: "Nimal", amountLkr: 10, method: "cash", branch: "Main" },
  propose_supplier_payment: { invoice: "PI-1", amountLkr: 10, bankAccount: "HNB" },
  propose_tax_payment: { periodFrom: "2026-01-01", periodTo: "2026-01-31", amountLkr: 10, method: "cash", branch: "Main" },
  propose_card_settlement: { bankAccount: "HNB", grossLkr: 100, feeLkr: 2 },
  propose_journal_adjustment: { debitAccount: "6080", creditAccount: "1000", amountLkr: 10, reason: "fix", branch: "Main" },
  propose_reverse_entry: { entry: "JE-000001", reason: "wrong" },
  propose_day_close: { countedCashLkr: 100, branch: "Main" },
};

describe.skipIf(!sqliteAvailable)("every assistant tool runs against the real schema", () => {
  let raw: SqliteDb;
  let ctx: AssistantContext;

  beforeAll(async () => {
    const m = migratedDb();
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x.lk','Owner','x',0,0), ('u2','c@x.lk','Clerk','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','City','CITY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1');
      INSERT INTO customers (id, code, name, phone, branch_id, created_at) VALUES ('c1','C001','Nimal Perera','0771234567','b1',0);
      INSERT INTO suppliers (id, code, name, branch_id, created_at) VALUES ('s1','S001','Gold Supplies Ltd','b1',0);
      INSERT INTO purchase_invoices (id, number, supplier_id, branch_id, subtotal_cents, total_cents, paid_cents, status, created_at)
        VALUES ('pi1','PI-1','s1','b1',500000,500000,0,'UNPAID',0);
      INSERT INTO cash_transfers (id, number, from_branch_id, to_branch_id, amount_cents, sent_on, status, reason, created_at)
        VALUES ('ct1','CT-1','b2','b1',100000,'2026-01-05','IN_TRANSIT','float',0);
    `);
    const { createBankAccount } = await import("../../services/cashbank");
    const { createCashEntry } = await import("../../services/cashentries");
    const bank = await createBankAccount(m.db, { name: "HNB Current", bankName: "HNB", branchId: "b1" }, "u1");
    const cash = await createCashEntry(m.db, { branchId: "b1", kind: "OWNER_CAPITAL", amountCents: 1_000_000, method: "cash", note: "float" }, "u1");
    raw.exec(`
      INSERT INTO expenses (id, number, category_id, branch_id, incurred_on, amount_cents, description, payment_account_code, bank_account_id, status, requested_by, created_at)
        VALUES ('e1','EXP-1','exp-utilities','b1','2026-01-05',900000,'Generator repair','${bank.accountCode}','${bank.id}','PENDING_APPROVAL','u2',0);
    `);
    ARGS.journal_entry = { entry: cash.entryNo };
    ARGS.propose_reverse_entry = { entry: cash.entryNo, reason: "wrong" };
    ctx = await buildContext({ DB: m.db, R2: {} as R2Bucket }, { userId: "u1", permissions: Object.values(PERMISSIONS), selectedBranchId: "b1" });
  });

  it("covers every tool", () => {
    const untested = ALL_TOOLS.filter((t) => t.kind === "write" && !(t.name in ARGS)).map((t) => t.name);
    expect(untested).toEqual([]);
  });

  for (const tool of ALL_TOOLS) {
    it(tool.name, async () => {
      const out = await runTool(ctx, tool.name, JSON.stringify(ARGS[tool.name] ?? {}));
      // With the records seeded above, every lookup resolves: an error here is a real defect.
      expect(out.kind === "error" ? out.content : "ok").toBe("ok");
      if (out.kind === "result") {
        expect(() => JSON.parse(out.content)).not.toThrow();
      } else if (out.kind === "draft") {
        expect(out.draft.path).toMatch(/^\/api\/v1\//);
        expect(out.draft.lines.length).toBeGreaterThan(0);
      }
    });
  }

  it("reports the seeded figures exactly", async () => {
    const read = async (name: string, args: Record<string, unknown>) => {
      const out = await runTool(ctx, name, JSON.stringify(args));
      if (out.kind !== "result") throw new Error(`${name}: ${out.kind === "error" ? out.content : "draft"}`);
      return JSON.parse(out.content) as Record<string, unknown>;
    };
    expect(await read("account_balance", { account: "cash on hand", branch: "Main" })).toMatchObject({
      account: "1000 Cash on Hand",
      balance_lkr: "LKR 10,000.00",
      normalSide: "debit",
    });
    expect(await read("supplier_account", { supplier: "gold supplies" })).toMatchObject({ unpaidTotal_lkr: "LKR 5,000.00" });
    expect(await read("cash_position", { branch: "Main" })).toMatchObject({ branches: [{ branch: "Main", cashInHand_lkr: "LKR 10,000.00" }] });
    expect(await read("calculate", { expression: "LKR 10,000.00 - LKR 9,000.00" })).toMatchObject({ result: 1000 });
  });

  it("asks rather than guesses when a name matches several records", async () => {
    raw.exec("INSERT INTO customers (id, code, name, branch_id, created_at) VALUES ('c2','C002','Nimal Silva','b1',0)");
    const out = await runTool(ctx, "customer_account", JSON.stringify({ customer: "Nimal" }));
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.content).toMatch(/AMBIGUOUS.*|Nimal Perera.*Nimal Silva|Nimal Silva.*Nimal Perera/);
  });

  it("refuses a future date and a proposal that would exceed what is owed", async () => {
    const future = await runTool(ctx, "trial_balance", JSON.stringify({ date: "2099-01-01" }));
    expect(future.kind === "error" && future.content).toMatch(/future/);
    const over = await runTool(ctx, "propose_supplier_payment", JSON.stringify({ invoice: "PI-1", amountLkr: 999999, bankAccount: "HNB" }));
    expect(over.kind === "error" && over.content).toMatch(/Only LKR 5,000.00 is outstanding/);
  });

  it("formats money nested under a cents key, and names gold-stock branches", async () => {
    const sup = await runTool(ctx, "supplier_account", JSON.stringify({ supplier: "gold supplies" }));
    expect(sup.kind).toBe("result");
    // totals_cents: { opening, closing, … } used to reach the model as raw cents.
    if (sup.kind === "result") expect(JSON.parse(sup.content).totals_lkr).toMatchObject({ opening: "LKR 0.00", closing: "LKR 0.00" });
    const gold = await runTool(ctx, "gold_stock", JSON.stringify({ groupBy: "branch" }));
    expect(gold.kind === "result" && gold.content).not.toMatch(/branch_id/);
  });

  it("refuses to label today's receivables and payables as a past date", async () => {
    for (const name of ["receivables", "payables"]) {
      const out = await runTool(ctx, name, JSON.stringify({ asOf: "2026-01-01" }));
      expect(out.kind === "error" && out.content).toMatch(/account_balance/);
      expect((await runTool(ctx, name, JSON.stringify({ asOf: ctx.today }))).kind).toBe("result");
    }
  });

  it("uses a month or quarter sent without its period instead of silently reporting this month", async () => {
    const out = await runTool(ctx, "profit_and_loss", JSON.stringify({ month: 1, year: 2026 }));
    expect(out.kind === "result" && JSON.parse(out.content)).toMatchObject({ period: "Month 2026-01 (2026-01-01 to 2026-01-31)" });
    const q = await runTool(ctx, "profit_and_loss", JSON.stringify({ quarter: 1, year: 2026 }));
    expect(q.kind === "result" && JSON.parse(q.content)).toMatchObject({ from: "2026-01-01", to: "2026-03-31" });
    const bad = await runTool(ctx, "profit_and_loss", JSON.stringify({ year: 2025 }));
    expect(bad.kind === "error" && bad.content).toMatch(/2025-01-01/);
  });

  it("shows the shop-wide scope for a manager and a whole-shop trial balance", async () => {
    const out = await runTool(ctx, "trial_balance", "{}");
    expect(out.kind).toBe("result");
    if (out.kind === "result") expect(JSON.parse(out.content)).toMatchObject({ scope: "whole shop (all 2 branches)", balanced: true });
  });
});
