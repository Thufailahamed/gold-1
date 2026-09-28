# GoldOS — Old Gold Management Design

Date: 2026-09-28
Status: Approved
Scope: Staged old-gold intake (receive→test→value→purchase→release),
configurable valuation, purchase batch with 5-ledger posting, resale
conversion with lineage, reports, counter UI. No melting linkage (locked),
no buy-back-from-sale yet.

## 1. Context

Sales flow gold OUT; purchases bring supplier stock IN; but customer
old-gold — a core Sri Lankan shop flow — has no module. Old gold is not an
ordinary purchase: it needs testing, negotiated valuation, customer
payables, and OG- identity. Approach: staged intake pipeline (A);
single-shot (B) and purchase-variant (C) rejected per above and user
direction.

Decisions (user-confirmed):
- Standard method list: acid, touchstone, XRF, electronic, fire assay.
- Purchase rate = board-rate % + deductions.
- Valuation defaults in settings with per-item override + reason.
- Sequential OG-000001 numbering.
- Cash/bank now + customer payable for remainder.

## 2. Schema (migration 0011_oldgold)

- `counters` += OG.
- `old_gold_items(id, number OG-000001 UNIQUE, customer_id FK, branch_id
  FK, item_type, description, gross_mg, stone_mg, net_mg,
  purity_id NULL FK, tested_permille NULL, karat NULL, fine_mg DEFAULT 0,
  rate_cents_per_g (board snapshot at valuation), buy_pct,
  purchase_rate_cents, stone_deduction_cents DEFAULT 0,
  processing_deduction_cents DEFAULT 0, negotiated_cents NULL,
  purchase_value_cents, paid_cents DEFAULT 0, status
  RECEIVED/TESTED/VALUED/PURCHASED/AVAILABLE/RESERVED_FOR_MELTING/MELTED/
  RESOLD/TRANSFERRED/VOID, converted_product_id NULL FK products,
  staff_id FK users, notes, image_keys JSON '[]', doc_keys JSON '[]',
  created_at, created_by)`.
- `gold_tests(id, item_id FK, method, tested_permille, tester_id FK,
  result pass/fail/inconclusive, approved_by NULL FK, notes, created_at)`.
- `old_gold_purchases(id, item_id FK UNIQUE, value_cents, paid_cents,
  method cash/bank, created_at, created_by)`.
- New perms `oldgold:view/create/edit/cancel/export/approve` (47 total):
  owner all; manager all; accountant view/export; gold_officer
  view/create/edit; cashier view/create; salesperson/inventory view;
  manufacturing none.

## 3. Staged flow, valuation, purchase

- `POST /oldgold/items` (customer, weights, type, description, branch →
  RECEIVED + OG number + audit). Photos/docs via
  `POST /oldgold/items/:id/files` (R2 `oldgold/{id}/`, images ≤5MB,
  docs ≤10MB any type, ≤10 each).
- `POST /oldgold/items/:id/tests` (method, permille, result, notes,
  approvedBy?): tester = caller; override (approvedBy with oldgold:approve,
  not self) required when permille differs from any prior test on the item
  by > 25 permille? No — simpler: override required flag passed by client
  when the tester knows the reading is exceptional... Ambiguity resolved:
  approvedBy required iff a previous test exists with a different permille
  (disagreement); first test needs no approval. Status →TESTED, item
  tested_permille/karat updated.
- `POST /oldgold/items/:id/value` (buyPct?, stone/processing deductions?,
  negotiatedTotal?, reason for overrides): fine = net×permille/1000;
  board rate = current rate for purity (snapshot); value = fine × rate ×
  pct − deductions, or negotiated total (reason required). buyPct default
  from settings `oldgold_buy_pct` (default 92). Status →VALUED.
- `POST /oldgold/items/:id/purchase` (paidCents, method cash/bank):
  remainder → customer payable. Atomic batch: status PURCHASED, purchase
  row, journal DR 1100 value / CR 1000|1010 paid (+ DR ... / CR 1200 with
  customer party for remainder), gold IN movement, audit.
- `POST /oldgold/items/:id/release` → AVAILABLE (melting pool).
- `POST /oldgold/items/:id/convert` (product fields: category, name…):
  creates JW- product (cost = purchase value, INTAKE), sets
  converted_product_id, item →RESOLD, lineage both ways. Only from
  AVAILABLE.
- `PATCH /oldgold/items/:id/void` (reason): pre-purchase states only.
- RESERVED_FOR_MELTING/MELTED/TRANSFERRED locked (409) until melting phase.
- `GET /oldgold/items` (filters status/purity/branch/customer/date),
  `GET /oldgold/items/:id` (full lineage + journal + tests),
  `GET /oldgold/items/barcode/:code` (OG- scan lookup).

## 4. UI + reports

- Old Gold section: Intake (customer search, weights, photos, instant OG
  label print), Testing queue, Valuation screen (live breakdown),
  Purchase (payment + outstanding), Items list + detail (tests, valuation,
  purchase, journal, movements, converted-product link).
- Reports: summary (today/month: items, gross/fine grams, value, paid,
  outstanding) + breakdowns (purity/customer/branch) + pending list
  (PURCHASED/AVAILABLE unmelted) + `GET /customers/:id/oldgold` history.
  Dashboard Gold Purchased wired to today fine grams.
- All screens scan-first (OG- + USB scanners as keyboard).

## 5. Data flow example

5g chain, 22K tested (916), board 28,500, buy 92%, 2,000 processing:
fine 4,580mg → 4.58×28,500×0.92 − 2,000 = 118,089 LKR... exact cents math
in integers. Paid 100,000 cash → payable 18,089 on customer 1200.
Batch: status, purchase row, journal (DR1100 118,089 / CR1000 100,000 +
CR1200 18,089 party), gold IN 4,580mg, audit → 201.

## 6. Testing

Vitest: valuation math (fine/rate/pct/deductions/negotiated), status
machine (locked transitions 409), disagreement-approval rule.
Live gate: full counter flow; 5 ledgers verified; override without
approval 403; purchase posts balanced journal; convert keeps lineage;
reports hand-verified; cashier cannot approve.

## 7. Out of scope

Melting linkage (statuses locked), buy-back of sold items, e-receipts,
SMS, assay-certificate PDFs.

## 8. Self-review

- No TBD/TODO; methods, thresholds, postings, grants explicit.
- Consistent: staged pattern (orders→invoices), batch+audit, journal
  composition, perm gating, R2 pattern, scan-first UI — all extend
  existing conventions; PURCHASED vs AVAILABLE split justified (melting
  pull model).
- Single plan: old-gold vertical only.
- Unambiguous: disagreement rule (>0 prior differing test), release
  semantics, negotiated-reason rule, void scope fixed.
