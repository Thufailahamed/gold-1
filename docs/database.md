# GoldOS Database

Engine: Cloudflare D1 (SQLite). Migrations: sequential SQL in
`apps/api/drizzle/`, never edit an applied migration. Drizzle schema in
`apps/api/src/db/schema.ts` mirrors the SQL.

## Phase-1 tables (migration `0001_core`)

- `users(id, email UNIQUE, name, password_hash, is_active, created_at, updated_at, created_by)`
- `roles(id, name UNIQUE)` — owner, manager, accountant, cashier, salesperson, inventory_officer, gold_officer, manufacturing_staff
- `permissions(id, name UNIQUE)` — 28 `domain:action` permissions (users, roles, branches, settings, audit, masters, products × view/create/edit/approve/cancel/export/manage as applicable; `reverse` reserved for transaction modules)
- `role_permissions(role_id, permission_id)` — composite PK
- `user_roles(user_id, role_id)` — composite PK
- `branches(id, name, code UNIQUE, address, is_active, created_at, created_by)`
- `branch_members(user_id, branch_id)` — composite PK
- `sessions(id, user_id, expires_at, created_at)` — 12h idle, 7d absolute
- `audit_logs(id, user_id, action, entity, entity_id, prev_json, new_json,
  reason, ip, branch_id, created_at)` — append-only, indexed on (entity, entity_id)
- `settings(key PK, value_json, type)` — string | number | boolean | json.
  Branch-scoped keys use `branch.{branchId}.{key}` and require settings:manage
  to write.
- `idempotency_keys(key PK, created_at)` — reserved for Phase-2 money/gold writes

Conventions: `id TEXT PK` (UUID), timestamps as INTEGER millis, FKs enforced.

## Foundation upgrade (migration `0004_foundation`)

- `password_resets(id, user_id FK, token_hash UNIQUE, expires_at, used_at NULL, created_at, created_by)` — only token hashes stored; 15-min TTL; single-use.
- Roles replaced: admin→owner, viewer→salesperson remapped; old role/permission rows removed; 28-permission matrix seeded (see permissions.md).

## Phase-2 masters tables (migration `0002_masters`)

- `categories(id, name UNIQUE, code UNIQUE, description, is_active, branch_id NULL = global, created_at, created_by)` — seeded: Ring, Chain, Bangle, Earring, Pendant, Necklace
- `purities(id, karat UNIQUE, purity REAL 0–1, default_making_charge, default_wastage_pct, is_active, created_at)` — seeded: 24K (1.0), 22K (0.916), 21K (0.875), 18K (0.75)
- `gold_rates(id, purity_id FK, rate_per_gram, effective_from, created_at, created_by)` — UNIQUE(purity_id, effective_from), immutable history; current = MAX(effective_from) <= now per purity
- `suppliers`, `customers(id, name, phone, address, nic UNIQUE NULLABLE, credit_limit, opening_balance, is_active, branch_id FK, created_at, created_by)`

## Phase-3 products table (migration `0003_products`)

- `products(id, barcode UNIQUE 'PRD-'+6 chars, category_id FK, purity_id FK, name, gross_weight, stone_weight, net_weight, making_charge, status 'in_stock'|'sold'|'void', branch_id FK, created_at, created_by)` — indexed on (barcode) and (branch_id, status). Superseded by 0005–0007 below.

## Product foundation (migrations `0005_catalog`, `0006_decimal`, `0007_inventory`)

- New masters: `subcategories(id, category_id FK, name, code UNIQUE)`, `designs`, `product_types`, `metal_types`, `stone_types` (id/name/code UNIQUE). Seeded metals GOLD/SILVER/PLATINUM, stones NONE/DIAMOND/RUBY/SAPPHIRE/EMERALD/PEARL.
- Minor units: weights INTEGER mg, money INTEGER cents, purity INTEGER permille. Converted in place (`ROUND(x*1000)` / `ROUND(x*100)`); old REAL columns dropped. `default_wastage_mg` reset to 0 for converted rows (percent defaults don't translate). API speaks grams/LKR, converts at the boundary.
- Products now: `sku UNIQUE`, `subcategory/design/product_type/metal/stone` FKs, `gross_mg/stone_mg/net_mg/fine_gold_mg`, `making_cents`, `wastage_mg`, `cost_cents?`, `selling_price_cents?`, `location?`, `notes?`, `image_keys` JSON (R2), status in 11-value set (IN_STOCK, RESERVED, SOLD, RETURNED, IN_REPAIR, IN_MANUFACTURING, TRANSFER_PENDING, MELTING, MELTED, LOST, VOID).
- `stock_movements(id, product_id FK, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by)` — append-only, indexed by (product, time) and (branch, time). Types: INTAKE, TRANSFER_OUT, TRANSFER_IN, RETURN, LOSS, VOID, SALE_OUT.

## Old gold (migrations `0011_oldgold`, `0012_goldlink`)

- `counters` += OG (sequential OG-000001).
- `old_gold_items(id, number UNIQUE, customer_id FK, branch_id FK, item_type, description, gross_mg, stone_mg, net_mg, purity_id NULL, tested_permille NULL, karat NULL, fine_mg, rate_cents_per_g (board snapshot), buy_pct, purchase_rate_cents, stone/processing_deduction_cents, negotiated_cents NULL, purchase_value_cents NULL, paid_cents, status RECEIVED/TESTED/VALUED/PURCHASED/AVAILABLE/RESERVED_FOR_MELTING/MELTED/RESOLD/TRANSFERRED/VOID, converted_product_id NULL FK, staff_id, notes, image_keys/doc_keys JSON, created_at, created_by)`.
- `gold_tests(id, item_id FK, method acid/touchstone/xrf/electronic/fire_assay, tested_permille, tester_id FK, result pass/fail/inconclusive, approved_by NULL FK, notes, created_at)`.
- `old_gold_purchases(id, item_id UNIQUE FK, value_cents, paid_cents, method cash/bank, created_at, created_by)`.
- `gold_movements` gained nullable `old_gold_id FK` (0012 rebuild; CHECK one of product/old-gold set) for IN gold rows.

## Manufacturing (migration `0014_manufacturing`)

- `counters` += MO (MO-000001).
- `manufacturing_orders(id, number UNIQUE, type CUSTOMER/INTERNAL, customer_id NULL FK, branch_id FK, design, description, due_at NULL, status DRAFT/ALLOCATED/IN_PRODUCTION/QC_PASSED/QC_FAILED/COMPLETE/VOID, labour/making/stone_cost cents, loss_mg, loss_reason, created_at, created_by)`.
- `manufacturing_materials(id, order_id FK, lot_batch_id FK, lot_number, fine_mg)` — indexed (lot_batch, lot_number) for remaining checks.
- `manufacturing_outputs(id, order_id FK, product_id NULL FK (set at finish), category/metal/purity refs, name, gross/stone/net mg, making_cents, cost_cents, location)`.

## Gold ledger + melting (migration `0013_goldledger`)

- `gold_ledger(id, occurred_at, branch_id, source, destination, type [12 types], weight_mg, permille, fine_mg, ref_entity, ref_id, product_id NULL, old_gold_id NULL, user_id, notes, created_at, created_by)` — append-only, indexed (branch,time), (ref), (product), (old_gold). Backfilled from gold_movements (sale_invoice→SALE, sale_return→RETURN, old_gold_purchase→OLD_GOLD_PURCHASE; unknown counterparties as explicit `unknown` strings).
- `melting_batches(id, number MELT-000001 UNIQUE via counters, branch_id, status DRAFT/LOCKED/MELTED/APPROVED/VOID, input/output/waste/loss/recovery fine mg, difference_reason, approved_by, notes, created_at, created_by)`, `melting_inputs(id, batch_id FK, old_gold_id FK UNIQUE, gross/net/fine snapshots)`, `melting_outputs(id, batch_id FK, lot_number MLT-{n}-01 UNIQUE, weight_mg, permille, fine_mg, output_type grain/bar)`.

## Sales (migration `0010_sales`)

- `counters` += SINV, SRET.
- `sales_invoices(id, number SINV-XXXX, customer_id NULL FK, branch_id FK, salesperson_id FK, subtotal_cents, discount_cents, total_cents, paid_cents, status, created_at, created_by)` + `sales_items(id, invoice_id FK, product_id FK, price_cents, discount_cents, cost_cents COGS snapshot)` + `sales_payments(id, invoice_id FK, amount_cents, method cash/card/bank/credit/other, ref, created_at, created_by)`.
- `sales_returns(id, number SRET-XXXX, invoice_id FK, type FULL/PARTIAL/EXCHANGE, reason, approved_by NULL FK, refund_cents, credit_cents, exchange_sale_id NULL FK, status, created_at, created_by)` + `sales_return_items(return_id FK, product_id FK, invoice_item_id FK)`.
- `gold_movements(id, product_id FK, direction IN/OUT, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by)` — minimal outflow ledger; future gold module absorbs it.

## Purchases (migration `0009_purchases`)

- `counters(name PK, next)` — PO/PINV sequences, bumped inside the batch.
- `purchase_orders(id, number UNIQUE PO-XXXX, supplier_id FK, branch_id FK, status DRAFT/SENT/RECEIVED/CANCELLED, notes, created_at, created_by)` + `purchase_order_items(id, order_id FK, category_id, purity_id, gross_mg, net_mg, est_cost_cents, notes)` — drafts, no postings.
- `purchase_invoices(id, number UNIQUE PINV-XXXX, order_id NULL FK, supplier_id FK, branch_id FK, subtotal_cents, charges_cents, total_cents, paid_cents, status UNPAID/PARTIAL/PAID/VOID, created_at, created_by)` + `purchase_invoice_items(id, invoice_id FK, product_id FK, gross_mg, net_mg, purity_id FK, cost_cents incl. charge share, making_cents)` + `purchase_payments(id, invoice_id FK, amount_cents, method cash/bank, ref, created_at, created_by)`.

## Financial ledger (migrations `0008_ledger`, `0015_ledger_core`, `0016_ledger_backfill`, `0017_retired_columns`)

`0008_ledger` seeded the chart and a flat journal. `0015` split the journal into
a header and its lines; `0016` backfilled the existing rows into entries and
migrated party opening balances; `0017` dropped what the new shape made
redundant.

### Chart of accounts

- `chart_of_accounts(code PK, name, type ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, is_active, is_system, description?, branch_id NULL)` — 24 accounts.
- `is_system = 1` marks an account the ledger posts into. System accounts reject
  edits, and so does any account with at least one journal line: renaming an
  account that has history would rewrite the meaning of that history.
- 1000 Cash · 1010 Bank · 1020 Card Clearing · 1100 Gold Inventory · 1200 Customer Receivables · 2000 Supplier Payables · 2100 Tax Payable · 2200 Other Payables · 3000 Owner's Equity · 3100 Opening Balances · 4000 Sales Revenue · 5000 Cost of Goods Sold · 5100 Gold Melting Loss · 5200 Gold Manufacturing Loss · 5300 Gold Adjustment Loss · 6000 Rent & Rates · 6010 Utilities · 6020 Salaries & Wages · 6030 Repairs & Maintenance · 6040 Transport & Delivery · 6050 Marketing & Advertising · 6060 Bank & Card Charges · 6070 Office & Consumables · 6080 Other Expenses.
- The chart is deliberately **flat** — no parent accounts, no group rollups.
  Reports group by `type`.
- Spec 3's expense categories each own an account here and point at it.

### Journal

- `journal_entries(id PK, entry_no UNIQUE, entry_date, memo?, ref_entity?, ref_id?, ref_no?, source_module, status POSTED|REVERSED, reverses_entry_id?, branch_id?, created_at, created_by)` — the header. Indexed by (entry_date, branch), (ref_entity, ref_id), (source_module, entry_date), status, reverses_entry_id.
- `journal_lines(id PK, entry_id, line_no, account_code FK, debit_cents, credit_cents, party_type?, party_id?, memo?)` — indexed by (entry_id, line_no), account, and (party_type, party_id).
- `entry_date` is **TEXT** `'YYYY-MM-DD'` in the shop's local day, not epoch
  millis. Cloudflare Workers run UTC and the shop is at UTC+5:30, so a
  `setHours(0,0,0,0)` day boundary is wrong for five hours every evening. The
  offset lives in `settings.business_tz_offset_minutes` (default 330), not in
  code. `entry_date` defaults to today and may be overridden — backdating is
  allowed, and spec 4 blocks it for a day that is already closed.
- `status` is `POSTED` or `REVERSED`. There is no `DRAFT`: an entry is always
  posted in the same atomic batch as the document that caused it.
- `source_module` is one of `sales, purchases, oldgold, expenses, bank, cash, closing, manual, manufacturing, melting, gold`.
- `entry_no` is `JE-000001`, allocated by a single atomic
  `UPDATE counters SET next = next + 1 … RETURNING`, reserved *outside* the
  caller's batch. A read-then-write split hands out the same number twice when
  one call posts two entries — a purchase paid on receipt posts a receive and
  a payment — and the second insert then dies on the unique index. Reserving
  outside the batch means a failed write leaves a gap, which is correct; a
  collision is not.
- Corrections are **reversals, never edits or deletes**: a mirror entry with
  debit and credit swapped, `reverses_entry_id` set, and the original flipped to
  `REVERSED`. A void reverses the entry its own document recorded, linked by
  `journal_entry_id` — not a mirror guessed from `ref_entity`/`ref_id`, which a
  purchase void shares with the receive it reverses.

### Party opening balances

`customers.opening_balance_cents` and `suppliers.opening_balance_cents` are
**retired** (`0017`). An opening balance is now an entry dated the day before
the party's first transaction, against 3100: a customer who starts owing us is
`DR 1200 / CR 3100`, a supplier we start owing is `DR 3100 / CR 2000`. The 3100
leg is left untagged so a sub-ledger only ever holds its own control account.

### Document → entry links

`sales_invoices`, `sales_returns`, `purchase_invoices` and `old_gold_purchases`
each gained `journal_entry_id`, written in the same batch as the entry so the
link cannot exist without the entry it points at.

### Book cost chain

`melting_batches` gained `input_cost_cents` and `melting_outputs` gained
`cost_cents`, so a melt lot carries what the shop actually paid rather than the
day's board rate. See `gold-accounting.md`.

### Counters

`JE` and `GADJ` were added alongside the existing `PO, PINV, SINV, SRET, OG,
MELT, MO`.

## Cash and bank (migration `0018_cash_bank`)

- `bank_accounts(id PK, name, bank_name?, account_number?, account_code UNIQUE FK chart_of_accounts, branch_id?, opening_balance_cents, opened_on?, is_active, created_at, created_by)` — one row per bank the shop uses.
- `card_settlements(id PK, number UNIQUE, bank_account_id, settled_on, gross_cents, fee_cents, net_cents, acquirer_ref?, note?, journal_entry_id?, created_at, created_by)`.
- `cash_transfers(id PK, number UNIQUE, from_branch_id, to_branch_id, amount_cents, sent_on, received_on?, status IN_TRANSIT|COMPLETE, reason, from_entry_id?, to_entry_id?, created_at, created_by)`.
- `bank_reconciliations(id PK, bank_account_id, statement_date, statement_balance_cents, ledger_balance_cents, difference_cents, note?, created_at, created_by)`.
- Indexes on `card_settlements(bank_account_id, settled_on)`, `cash_transfers(status, sent_on)`, `bank_reconciliations(bank_account_id, statement_date DESC)`.
- Counters `SETL` and `XFER` added.

**Account-code allocation.** The first bank account adopts the existing `1010
Bank` system account, so a shop that has only ever had one bank does not get a
second account it never asked for. Each later account takes the **lowest unused
code in 1011-1099**, minus `1020` (Card Clearing), and is created with
`is_system = 0` so the chart's system-account guard still applies to it. When
the range is exhausted the request fails with `VALIDATION` rather than
inventing a code outside the asset block.

**A transfer is never cancelled.** One that turns out to be wrong is a second,
opposite transfer, per the append-only rule. `cash_transfers` therefore has no
`VOID` status.

## Expenses (migration `0019_expenses`)

- `expense_categories(id PK, name, description?, account_code UNIQUE FK chart_of_accounts, is_active, created_at, created_by)` — **one account per category**.
- `expenses(id PK, number UNIQUE, category_id, branch_id, incurred_on, amount_cents, vendor?, description, payment_account_code, bank_account_id?, status, receipt_key?, journal_entry_id?, requested_by?, approved_by?, approved_at?, rejection_reason?, created_at, created_by)`.
- `status` is `PENDING_APPROVAL` | `POSTED` | `REJECTED`. There is no `VOID`: a rejected expense stays visible with its reason, per the append-only rule. There is no `DRAFT` either — the row and, when no approval is required, the journal entry land in one batch.
- `payment_account_code` stores the **resolved** account (`1000` for cash, or the bank account's own code) rather than recomputing it, so the record still says where the money came from after a bank account is renamed.
- Indexes on `expenses(branch_id, incurred_on)`, `(status, incurred_on)`, `(category_id, incurred_on)`.
- Counter `EXP` added.

### Seeded categories

Nine categories bind the accounts the ledger core already created, so no
account sits empty and unexplained: `exp-rent` 6000, `exp-utilities` 6010,
`exp-salaries` 6020, `exp-repairs` 6030, `exp-transport` 6040,
`exp-marketing` 6050, `exp-bankfees` 6060, `exp-office` 6070, `exp-other`
6080.

A new category takes the **lowest unused code in 6090-6199** and creates the
ledger account in the same batch — the same rule bank accounts use for
1011-1099. A category with journal history cannot be deactivated, because its
account would stop adding up against the expenses already booked to it.

### Thresholds

Both gates are settings, not code, so a shop that wants two people on
everything sets the approval threshold to `1`:

| Setting key | Default | Meaning |
|---|---|---|
| `expense_approval_threshold_cents` | `500000` (LKR 5,000) | above this, approval is required before the entry posts |
| `expense_receipt_required_cents` | `1000000` (LKR 10,000) | above this, a receipt must be attached before approval |

Both gates are strictly-greater-than: an expense exactly *at* a threshold is
not gated. A threshold is a "watch anything above this" line, and the shop
sets it to its largest routine spend.

## Later-phase reservations (not yet created)

- Gold ledger: gross/stone/net weight, purity, karat, fine-gold equiv, rate,
  source → destination, wastage, recovery, loss. Every row carries `branch_id`.
- Financial ledger: revenue, COGS, cash, bank, receivables, payables, payments,
  refunds, adjustments. Every sale/purchase auto-posts entries in the same batch.
- All business tables carry `branch_id`; inventory/cash are branch-scoped.
- The 30+ journal `entry_no` values that the pre-0015 rows were backfilled
  under use a `JE-B` prefix so they cannot be confused with the live `JE-`
  sequence, which starts fresh.
