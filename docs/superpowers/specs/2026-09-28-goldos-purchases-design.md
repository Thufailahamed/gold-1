# GoldOS — Jewellery Purchases Design

Date: 2026-09-28
Status: Approved
Scope: Two-stage orders→invoices, atomic 7-step receive, payments + credit,
void with reversal, supplier ledger integration, purchase reports, UI.
No old-gold, no sales, no customer histories.

## 1. Context

Party ledgers (double-entry journal, chart, CUS-/SUP- codes) are live; the
journal has no business postings yet. This spec puts it to work with
jewellery purchasing. Approach: invoice as atomic orchestrator composing
existing primitives (A); draft-then-post (B) and SQL bypass (C) rejected.

Decisions (user-confirmed):
- Two-stage order (draft, no postings) → receive/invoice (full atomic flow).
- Flexible payment: full/partial/credit; cash/bank; outstanding payable.
- Per-item cost; charges allocated by net weight.

## 2. Schema (migration 0009_purchases)

- `counters(name TEXT PK, next INTEGER)` — `PO`, `PINV` sequences, incremented
  inside the batch.
- `purchase_orders(id, number UNIQUE PO-XXXX, supplier_id FK, branch_id FK,
  status DRAFT/SENT/RECEIVED/CANCELLED DEFAULT DRAFT, notes, created_at,
  created_by)`.
- `purchase_order_items(id, order_id FK, category_id FK, purity_id FK,
  gross_mg, net_mg, est_cost_cents, notes)`.
- `purchase_invoices(id, number UNIQUE PINV-XXXX, order_id NULL FK,
  supplier_id FK, branch_id FK, subtotal_cents, charges_cents, total_cents,
  paid_cents DEFAULT 0, status UNPAID/PARTIAL/PAID/VOID DEFAULT UNPAID,
  created_at, created_by)`.
- `purchase_invoice_items(id, invoice_id FK, product_id FK, gross_mg,
  net_mg, purity_id FK, cost_cents, making_cents)`.
- `purchase_payments(id, invoice_id FK, amount_cents, method cash/bank,
  ref_entity, ref_id, created_at, created_by)`.
- New perms `purchases:view/create/edit/cancel/export` (36 total): owner all;
  manager all; accountant view/export; inventory_officer view/create/edit;
  cashier/salesperson/gold_officer view; manufacturing none.

## 3. Atomic receive, payments, void

- `POST /purchases/orders` (draft items, no postings), `POST
  /purchases/orders/:id/receive`, `POST /purchases/invoices` (direct) —
  receive/direct share one service: validate supplier/branch/refs →
  next numbers from counters → per item create product (JW-, SKU, INTAKE)
  → invoice + items → `postJournalStmts` DR 1100 / CR 2000 (+ DR 2000 /
  CR 1000|1010 on payment) → payment row → audit. One batch; any failure
  rolls back. Charges allocated to items by net-weight share (rounded,
  remainder to first item).
- `POST /purchases/invoices/:id/payments` (amount ≤ total − paid, method
  cash/bank; journal DR 2000 / CR 1000|1010; status recomputed).
- `PATCH /purchases/invoices/:id/void` (reason): only if all products still
  IN_STOCK → void products (VOID movements), reversal DR 2000 / CR 1100,
  status VOID; else 409.
- `GET /purchases/orders`, `GET /purchases/invoices` (filters supplier,
  branch, status, date), `GET /purchases/invoices/:id` (full detail +
  journal + payments).

## 4. UI + reports

- Purchases section: Orders (list/create/receive/cancel), Invoices
  (list/create/detail with items, payments, Pay dialog, Void).
- Supplier ledger shows purchase/payment lines automatically.
- Reports: `GET /purchases/reports/summary?period=today|month&
  supplierId=&groupBy=purity|category` (invoices, value, gold grams) +
  by-supplier/purity/category breakdowns; UI cards + tables + CSV export
  (`purchases:export`); dashboard Today's Purchases wired to today total.

## 5. Data flow example

Receive 2-ring order LKR 300,000 + 5,000 charges, 100,000 paid cash:
batch [counters+2, products+2, movements+2, invoice+items, journal
DR1100 305,000/CR2000 305,000 + DR2000 100,000/CR1000 100,000, payment,
audit] → 201. Status PARTIAL, outstanding 205,000.

## 6. Testing

Vitest: charge allocation sums to total; status recompute matrix.
Live gate: draft→receive full flow; ledger + journal + stock + audit all
present; partial payment math; void reverses and blocks sold-product void;
cashier cannot create; reports match hand-computed totals.

## 7. Out of scope

Old-gold purchasing, sales, customer histories, melting/manufacturing,
email, multi-currency.

## 8. Self-review

- No TBD/TODO; numbers, postings, transitions, grants explicit.
- Consistent: batch+audit, envelope, branch scoping, journal composition,
  perm gating — all extend existing patterns.
- Single plan: purchases vertical only.
- Unambiguous: charge allocation rule, void preconditions, payment bounds,
  report shapes fixed.
