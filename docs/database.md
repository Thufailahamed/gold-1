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

## Accounting foundation (migration `0008_ledger`)

- `chart_of_accounts(code PK, name, type ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, is_active, branch_id NULL)` — seeded 11 accounts (1000 Cash, 1010 Bank, 1100 Gold Inventory, 1200 Receivables, 2000 Payables, 2100 Tax, 3000 Equity, 3100 Opening, 4000 Revenue, 5000 COGS, 6000 Expenses).
- `journal_entries(id, account_code FK, debit_cents, credit_cents, party_type?, party_id?, ref_entity, ref_id, memo?, branch_id?, created_at, created_by)` — append-only, indexed by (account, time), (party, time), (ref).
- Parties gain `code` (CUS-/SUP-XXXXXX, backfilled) and `notes`.

## Later-phase reservations (not yet created)

- Gold ledger: gross/stone/net weight, purity, karat, fine-gold equiv, rate,
  source → destination, wastage, recovery, loss. Every row carries `branch_id`.
- Financial ledger: revenue, COGS, cash, bank, receivables, payables, payments,
  refunds, adjustments. Every sale/purchase auto-posts entries in the same batch.
- All business tables carry `branch_id`; inventory/cash are branch-scoped.
