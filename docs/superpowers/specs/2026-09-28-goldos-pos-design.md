# GoldOS — POS & Sales Design

Date: 2026-09-28
Status: Approved
Scope: Atomic sale checkout, split payments, discounts with approval,
professional invoice, full/partial returns + exchange linkage, sales
reports, POS screen. No layaway, no e-receipts, no loyalty.

## 1. Context

Purchases post inventory/payables; the journal has revenue/COGS/receivable
accounts waiting. This spec builds the selling vertical with the same
orchestrator pattern. Approach: atomic sale batch (A); stepwise UI calls
(B) and purchase-clone (C) rejected.

Decisions (user-confirmed):
- Checkout + returns + reports in one spec.
- Role discount limits + manager approval over limit.
- Walk-ins allowed; customer required for credit.
- Full returns + linked two-call exchange.

## 2. Schema (migration 0010_sales)

- `counters` += SINV, SRET.
- `sales_invoices(id, number SINV-XXXX, customer_id NULL FK, branch_id FK,
  salesperson_id FK users, subtotal_cents, discount_cents, total_cents,
  paid_cents, status UNPAID/PARTIAL/PAID/VOID, created_at, created_by)`.
- `sales_items(id, invoice_id FK, product_id FK, price_cents,
  discount_cents, cost_cents COGS snapshot)`.
- `sales_payments(id, invoice_id FK, amount_cents, method
  cash/card/bank/credit/other, ref, created_at, created_by)`.
- `sales_returns(id, number SRET-XXXX, invoice_id FK, type
  FULL/PARTIAL/EXCHANGE, reason, approved_by NULL FK, refund_cents,
  credit_cents, exchange_sale_id NULL FK, status, created_at, created_by)`,
  `sales_return_items(return_id FK, product_id FK, invoice_item_id FK)`.
- `gold_movements(id, product_id FK, direction IN/OUT, fine_mg,
  purity_permille, ref_entity, ref_id, branch_id, created_at, created_by)`
  — minimal outflow ledger; future gold module absorbs it.
- New perms `sales:view/create/edit/cancel/export/approve` (41 total):
  owner all; manager all; accountant view/export; cashier view/create;
  salesperson view/create; gold_officer/inventory_officer view;
  manufacturing none.

## 3. Atomic sale, discounts, payments

- `POST /sales/invoices`: items[] (productId, priceLkr?, discountLkr?),
  customerId?, payments[] (method+amountLkr), discountApproval?
  (approver user id). Validates IN_STOCK + same branch; price defaults to
  selling_price_cents ?? live price; discount % per role limit
  (`discount_limit_{role}`, defaults cashier/salesperson 5, manager 15,
  owner 100) — over-limit needs approver with sales:approve (not self);
  credit/partial requires customerId. Batch: invoice + items + SOLD +
  SALE_OUT movements + gold OUT rows + journal (DR cash/bank/receivable
  split / CR 4000; DR 5000 / CR 1100 at cost) + payments + audit → 201.
  Card/bank-transfer/other post to 1010 with method on payment row.
- `GET /sales/invoices` (filters), `GET /sales/invoices/:id` (full +
  journal + returns).

## 4. Returns, invoice, reports, UI

- `POST /sales/returns` (invoiceId, itemIds[]|all, type, reason,
  refundMethod|storeCredit, approverId?): validates ownership, no double
  return; ≥ `return_approval_threshold` (default 100,000 LKR) needs
  sales:approve approver; batch: return + items, products →RETURNED,
  reversal journal (DR 4000 / CR 1000|1010|1200), audit. Exchange:
  return with type EXCHANGE + later sale passing `exchangeReturnId`
  (stored link). Original sale never modified.
- Print view: shop/branch/SINV/datetime/customer/lines (barcode, SKU,
  weights, purity, making, discount)/totals/payment split; print CSS.
- Reports mirror purchases: summary (today/month/all) + breakdowns by
  category/purity/branch/salesperson/payment-method/product; CSV export
  (sales:export).
- `/pos` screen: autofocus scan, instant lookup, cart, customer search,
  discount meter vs role limit, split-payment editor, F2/F9/Enter
  shortcuts, printable invoice on completion. Sidebar Sales section;
  dashboard Today's Sales + Gold Sold wired to summary.

## 5. Data flow example

2 items 200,000 + 150,000, 10,000 discount (manager-approved), paid
100,000 cash + 150,000 card + 90,000 credit: batch [invoice 340,000,
items, 2×SOLD + movements + gold OUT, journal DR1000 100k/DR1010 150k/
DR1200 90k/CR4000 340k + DR5000 cost/CR1100 cost, 3 payments, audit] → 201
PARTIAL, outstanding 90,000 on customer ledger.

## 6. Testing

Vitest: discount % math, payment-split sum validation, approval matrix.
Live gate: full counter flow; ledger/journal/stock/gold/audit all present;
over-limit discount 403 → approved 201; credit without customer 400;
partial return reverses subset; double return 409; exchange linkage;
reports hand-verified; cashier cannot void/approve.

## 7. Out of scope

Layaway/installments, e-receipts/SMS, loyalty points, buy-back (old-gold
phase), multi-currency.

## 8. Self-review

- No TBD/TODO; numbers, postings, thresholds, grants explicit.
- Consistent: orchestrator batch, journal composition, perm gating,
  branch scoping, print CSS — all extend existing patterns; gold_movements
  shaped for future absorption.
- Single plan: selling vertical only.
- Unambiguous: discount base (line total), approval identity rules,
  exchange linkage, COGS source fixed.
