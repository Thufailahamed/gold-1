# GoldOS — Party Ledgers & Accounting Foundation Design

Date: 2026-09-28
Status: Approved
Scope: Double-entry journal + chart of accounts, CUS-/SUP- codes, notes,
party detail + ledger views, adjustments, Accounts UI. No purchases,
payments, histories (sales/returns/repairs/orders), or reports — those are
next specs.

## 1. Context

Suppliers/customers exist (contact, NIC, credit/opening in cents, branch)
and products post intake movements, but money has no books: no chart, no
journal, no party balances. This spec lays the accounting foundation that
purchases (next) will post into. Approach: journal-first double-entry (A);
running balances (B) and bundling with purchases (C) rejected per user
choices.

Decisions (user-confirmed):
- Ledgers before purchases; histories/reports after.
- Double-entry journal, balances derived.
- CUS-/SUP- coded IDs, backfilled.
- NIC remains the only ID field.

## 2. Chart + journal (migration 0008_ledger)

- `chart_of_accounts(code TEXT PK, name, type
  ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, is_active DEFAULT 1,
  branch_id NULL)` seeded: 1000 Cash on Hand (ASSET), 1010 Bank (ASSET),
  1100 Gold Inventory (ASSET), 1200 Customer Receivables (ASSET),
  2000 Supplier Payables (LIABILITY), 2100 Tax Payable (LIABILITY),
  3000 Owner's Equity (EQUITY), 3100 Opening Balances (EQUITY),
  4000 Sales Revenue (REVENUE), 5000 Cost of Goods Sold (EXPENSE),
  6000 Operating Expenses (EXPENSE).
- `journal_entries(id, account_code FK, debit_cents, credit_cents,
  party_type NULL, party_id NULL, ref_entity, ref_id, memo, branch_id,
  created_at, created_by)` — append-only, indexed (account, party, ref).
- `postJournal(db, { lines: [{account, debitCents, creditCents,
  partyType?, partyId?}], refEntity, refId, memo, branchId, actorId })`:
  rejects unbalanced (ΣDR ≠ ΣCR → VALIDATION) and inactive accounts;
  inserts lines + audit row in the caller's batch (returns stmts, doesn't
  execute — composes into purchase batches later).
- Balances: customer = opening_balance_cents + ΣDR − ΣCR on 1200 by party;
  supplier = opening_balance_cents + ΣCR − ΣDR on 2000 by party. Derived,
  never stored.
- Endpoints: `GET /accounts` (chart + per-account ΣDR−ΣCR, ?branchId=),
  `POST /accounts/adjustments` (two-leg balanced entry + reason,
  perm accounts:manage), `GET /customers/:id/ledger`,
  `GET /suppliers/:id/ledger` (profile + lines + opening + balance).
- New perms `accounts:view`, `accounts:manage` (31 total): manage =
  owner/manager/accountant; view = owner/manager/accountant/cashier.
  Seeded in migration + DEFAULT_ROLES + seed.ts.

## 3. Party enrichment (same migration)

- `customers`/`suppliers` gain `code TEXT UNIQUE` (CUS-/SUP- + 6 chars,
  same alphabet as SKU) and `notes TEXT`. Backfill existing rows in SQL
  with random codes. Codes assigned server-side on create, immutable.
- New `GET /customers/:id`, `GET /suppliers/:id` (profile; perm
  masters:view). Existing PATCH accepts `notes` (+ code rejected if sent).
- History sections (sales/payments/returns/repairs/orders) explicitly
  deferred — ledger tab only.

## 4. UI

- Customer/supplier drawers gain ledger tab: balance header (opening,
  debits, credits, balance), journal-lines table, empty state ("No
  transactions yet").
- Accounts page: chart table with balances + branch filter; adjustment
  dialog (debit/credit account selects, amount, memo, reason).
- Sidebar "Accounts" (`accounts:view`). No stub tabs for deferred modules.

## 5. Data flow example

Adjustment: validate accounts active + DR == CR + reason → batch
[INSERT journal ×2, INSERT audit] → 201. Purchase (next spec) will call
postJournal inside its 7-step batch: DR 1100 / CR 2000 (+ DR 2000 / CR
1000 on payment).

## 6. Testing

Vitest: unbalanced journal rejected; balance math (opening + lines).
Live gate: chart seeded (11 accounts); adjustment posts + appears in
account balance; party ledgers show opening + entries; cashier cannot
adjust (403); codes unique; audit rows for adjustments.

## 7. Out of scope

Purchases, payments, sales, returns, repairs, orders, old gold, reports,
email, R2. `reverse` action still unseeded.

## 8. Self-review

- No TBD/TODO; account codes, journal shape, balance formulas, grant sets,
  code formats explicit.
- Consistent: batch+audit, envelope, branch scoping, perm gating; journal
  stmts compose into future batches by design.
- Single plan: ledger infra only, no business postings yet.
- Unambiguous: sign conventions, opening handling, immutable codes,
  adjustment guard fixed.
