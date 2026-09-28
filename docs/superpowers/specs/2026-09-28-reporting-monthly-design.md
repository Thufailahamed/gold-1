# GoldOS — Monthly Reporting & Accounting Design

Date: 2026-09-28
Status: Approved (report-only snapshot, ledger-only P&L, CSV+Print+Client Excel)
Scope: Monthly close snapshot + P&L + cashflow + receivables/payables + inventory valuation + filtered exports + owner analytics. No month lock, no server PDF/Excel, no revaluation in profit.

## 1. Context

The shop posts everything to the dual ledger already (sales, purchases, old gold, melting, manufacturing, expenses, cash/bank, adjustments) with `journal_entries.entry_date` as shop-local TEXT `YYYY-MM-DD` and per-branch `branch_id`. Day closing freezes one branch-day with an 18-check gate and a posting lock in `buildEntryStmts`.

What is missing is the month view the owner/accountant needs: pick Month + Year + Branch, get sales/purchases/gold/expenses/profit/cashflow/receivables/payables/inventory in one screen, freeze it, export it, and see trends on a premium dashboard. Existing per-module `reports/summary` + `reports/breakdown` endpoints use epoch `created_at` windows (`today/month/all`) and do not agree with `entry_date` month boundaries — they cannot be the monthly source of truth.

User-confirmed decisions:
- Monthly close is a **report-only snapshot**: generate + freeze `report_json` in a new table, no posting lock, no change to `buildEntryStmts`.
- Profit is **ledger-only**: Revenue 4000, COGS 5000, gold losses 5100+5200+net 5300, opex 6000–6199 from posted journal. Board-rate revaluation is an `estimates` section with `kind: "estimate"`, never in net profit.
- Exports are **CSV server-side + print-friendly view (browser → PDF) + client SheetJS `.xlsx`** from the same JSON. No server PDF/Excel libs on Workers.

## 2. Month window + branch scoping

- Input: `{ month: 1–12, year: 1970–2100, branchId?: string }`. Server derives `from = YYYY-MM-01`, `to = last day of month` via pure `monthBounds(year, month)` in `@goldos/shared` (no `setHours`, no UTC day math; validates with `isBusinessDate`).
- Ledger queries filter `journal_entries.entry_date BETWEEN from AND to`. Document side filters by the document's shop-local day: `${LOCAL_DAY("col")} BETWEEN from AND to` is wrong for range — use `date(col/1000,'unixepoch','+330 minutes') >= from AND <= to` via `businessDateFor` offset setting (default 330, read from settings like dayBounds does). Gold uses `gold_ledger.occurred_at` same way.
- Branch: when `branchId` supplied, filter `journal_entries.branch_id = ?` and doc `branch_id = ?`. When absent, shop-wide; requires `branches:manage`, else scoped to caller's `branch_members` (same rule as `listSales`). Expenses cross-foot stays unfiltered (head-office cost paid from main bank problem, per reconcile.ts) and is labeled as such.
- Empty month: every section returns zeros with `hasData: false`, never null-fabricated or carried-forward. Opening balances are ledger sums `< from`, so first month and missed months still reconcile.

## 3. Schema (migration `0021_monthly`)

```sql
CREATE TABLE month_snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id),
  month TEXT NOT NULL, -- 'YYYY-MM'
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_ms_branch_month ON month_snapshots(COALESCE(branch_id,''), month);
CREATE INDEX idx_ms_month ON month_snapshots(month);
```

- No status, no reopen table: a snapshot is a frozen reading, not a lock. Re-generating creates a new row (or replaces by unique key with audit log); the old `report_json` is kept in `audit_logs` prev/new.
- Every snapshot write batches with its `audit_logs` row (entity `month_snapshot`), per Phase-1 rule. No postings, no journal entries, no counters.

## 4. Monthly aggregate contract

`GET /reports/monthly?month&year&branchId?&categoryId?&purityId?&staffId?` → one JSON:

```
sales: { totalCents, invoiceCount, grossCents, returnsCents, netCents, byCategory[], byBranch[], bySalesperson[], hasData }
purchases: { jewelleryCents, oldGoldCents, supplierCents, purchaseValueCents, goldFineMg, hasData }
gold: { openingFineMg, purchasedFineMg, oldGoldFineMg, meltedInMg, meltedOutMg, recoveredMg, lossMg, usedInMfgMg, soldFineMg, transfersFineMg, adjustmentsFineMg, closingFineMg, hasData }
expenses: { byCategory[{accountCode,name,cents}], totalCents, pendingCents, hasData }
profit: { revenueCents, cogsCents, grossProfitCents, operatingExpensesCents, netProfitCents, lossAccounts{5100,5200,5300}, basis: "ledger-posted-only" }
cashflow: { openingCents, inflowsCents, outflowsCents, closingCents, byRef[{refEntity,cents}], hasData }
receivables: { lines[{partyId,name,balanceCents}], aging{0-30,31-60,61-90,90plus}, outstandingInvoices[], totalCents }
payables: { lines[{partyId,name,balanceCents}], aging{...}, outstandingPurchases[], totalCents }
inventory: { jewelleryCents, goldCents, byBranch[], byCategory[], byPurity[], basis: "book-cost" }
estimates: [{ kind:"estimate", label, cents?, mg?, note }] — board-rate memo only
meta: { from, to, branchId, generatedAt, snapshotId? }
```

Derivation (all ledger-first, docs as detail):
- Sales: net `4000` credits−debits in window = netCents; gross = `sales_invoices.total_cents` sum (status<>VOID, not reversed); returns = `sales_returns.refund+credit` (COMPLETE); count = invoice count. Breakdowns reuse `salesBreakdown` groupBys but re-windowed to entry_date month.
- Purchases: `1100` debits with `source_module='purchases'` = purchaseValue; jewellery vs supplier split by doc type; oldGold = `1100` debits with `source_module='oldgold'`; goldFineMg from `gold_ledger` PURCHASE + OLD_GOLD_PURCHASE in window.
- Gold: opening = directional ledger sum `< from` (destination branch − source branch, transfer-safe CASE from reconcile.ts); flows = same directional sums per type in window (PURCHASE, OLD_GOLD_PURCHASE, MELTING_INPUT/OUTPUT, MANUFACTURING_INPUT/OUTPUT, SALE, TRANSFER, ADJUSTMENT/LOSS/RECOVERY); closing = opening + in − out. Uses `heldGoldMg` composition for cross-check, reported as `crossCheckMg`.
- Expenses: posted `expenses` + journal category legs in window, grouped by `expense_categories.account_code`; `pendingCents` = PENDING_APPROVAL sum shown above arithmetic (day-close awaiting-approval rule).
- Profit: revenue = 4000 net credit; cogs = 5000 net debit; gross = revenue − cogs; opex = 6000–6199 debits; net = gross − opex − (5100+5200+net5300). All from `journal_lines` in window. No config mapping — fixed chart per database.md.
- Cashflow: opening = `1000` + bank accounts + `1020` + `1030` balance `< from`; inflows/outflows = debits/credits in window by `ref_entity` (KNOWN_CASH_REFS + card_settlement/expense/cash_*); closing = opening + in − out. Unrecognised ref → `unclassifiedCents` and snapshot refused with 409 (day-close guard, same list).
- Receivables: customer `1200` party balances as of `to` (opening entry + DR−CR); aging by invoice `created_at` business day vs `to` (buckets 0–30/31–60/61–90/90+); outstanding = UNPAID/PARTIAL invoices + credit-balance lines flagged (not netted away).
- Payables: mirror on `2000`.
- Inventory: jewellery = `SUM(products.cost_cents)` IN_STOCK-ish statuses scoped to branch; gold = melt lots remaining + old-gold AVAILABLE at `cost_cents`/`purchase_value_cents`; byBranch/byCategory/byPurity group the same sums. Basis labeled `book-cost`; board-rate `weight × current rate` shown only in `estimates` with `Board-rate memo — not in profit or stock value`.

## 5. Routes + permissions + filters

- `GET /reports/monthly` — `accounts:view`. Query: `month,year,branchId?,categoryId?,purityId?,staffId?`. Zod-validated; invalid month/year → 400 VALIDATION.
- `POST /reports/monthly/snapshot` — `accounts:manage`. Same query in body + freeze to `month_snapshots` + audit.
- `GET /reports/monthly/:id` — `accounts:view`. Frozen `report_json`.
- `GET /reports/monthly?format=csv&section=sales|purchases|gold|expenses|profit|cashflow|receivables|payables|inventory` — requires `audit:export` (owner/manager/accountant already hold it; single gate so a cross-domain monthly file has one auditable permission). Streams `text/csv` with header row + `source: ledger-posted` comment line.
- `GET /reports/pnl`, `/reports/cashflow`, `/reports/aging`, `/reports/valuation` — thin aliases returning the matching section of the same service (so dashboard widgets fetch small payloads). Same perms/filters.
- Filters: date = month window only (no ad-hoc ranges in v1 — prevents epoch/entry_date mismatch); branch/category/purity/staff passthrough to breakdown subqueries. Staff = `salesperson_id` / `created_by`.
- Errors: failing cross-check (e.g. gold ledger vs heldGoldMg ≠ 0, trial balance ≠ 0 for window) returns 200 with `passed:false`-style `warnings[]`, never silent; snapshot with warnings requires `{ note: string }` in the POST body (day-close difference-reason rule).

## 6. No-fabrication guards

- Every money figure is posted-journal cents; every weight is ledger fine mg. No mixing (no `goldValueCents` in P&L).
- Cents exact with 1-cent reconcile tolerance only; mg exact (0 tolerance).
- `hasData:false` + zeros for empty months; dashboard shows "No postings this month" not "0 growth".
- Estimates array is visually and structurally separate (`kind:"estimate"`, `Not in profit` note). Client must render it in a distinct panel.
- CSV includes `generated_at, from, to, branch, basis` preamble so an exported file cannot be mistaken for an audited statement.

## 7. Web UI

- `/(app)/reports/monthly`: Month/Year/Branch pickers (owner/accountant; branch dropdown scoped like API), section cards matching contract, freeze-snapshot button (`accounts:manage` only), CSV per-section buttons, print stylesheet (browser → PDF).
- `/(app)/analytics` (premium owner dashboard): trend charts (revenue/net/cash/gold flows last 12 months via 12× monthly calls, cached with TanStack Query), top categories/salespeople, aging bars, inventory donut by purity. Every tile shows `Ledger` or `Estimate` badge. Empty states, no sparkline smoothing that hides gaps.
- Sidebar: `Reports` (accounts:view) + `Analytics` (owner/manager/accountant). No new permission — reuses `accounts:view/manage` + export gates per permissions.md (count stays 53).

## 8. Testing

- Shared pure fns: `monthBounds`, `agingBuckets`, `monthlyPnl(revenue,cogs,opex,losses)`, `cashflowClose`, `goldClose` — unit tests in `packages/shared` (vitest), including month-boundary (Jan 31→Feb), leap year, exact-mg, 1-cent tolerance, empty-month zeros.
- API: `monthly.test.ts` — fixed seed (2 sales + 1 return + 1 purchase + 1 expense + 1 old-gold + 1 melt) asserts every section total; snapshot freeze + re-read equality; unclassified-cash 409; warnings+note gate; branch scoping (transfer nets shop-wide, ± per branch); perm 403s.
- Web: route renders with mocked API, filter changes refetch, estimate badge present, CSV link hits `format=csv`.

## 9. Build slices (separate plans)

1. Slice 1 — Monthly core: migration 0021 + `monthly.ts` (sales/purchases/gold/expenses/profit/cashflow) + `GET /reports/monthly` + snapshot + tests.
2. Slice 2 — Receivables/payables/inventory: aging + valuation sections + `/aging` + `/valuation` + tests.
3. Slice 3 — Exports + dashboard: CSV variants + print view + `/reports/monthly` + `/analytics` pages + SheetJS client xlsx.

Out of scope: month lock, budget vs actual, forecasting, tax filings, payroll, server PDF/Excel, ad-hoc date ranges, multi-currency.
