# GoldOS — Manufacturing Design

Date: 2026-09-28
Status: Approved
Scope: Staged manufacturing orders (customer + internal) consuming refined
lots, QC pass/rework loop, finished JW- products with costing, gold ledger
integration, lineage, reports, UI. No artisan tracking, no refining fees,
no repairs module.

## 1. Context

Melting produces approved refined lots with no consumer; finished products
enter via purchase/intake or old-gold conversion only. This spec closes the
loop: lots → manufacturing → sellable jewellery, unlocking the
IN_MANUFACTURING state. Approach: staged pipeline (A); single-shot (B) and
intake-variant (C) rejected.

Decisions (user-confirmed):
- Refined lots only (no direct old-gold/product consumption).
- Customer + internal orders.
- Per-order labour/making/stone totals.
- QC pass/rework loop (scrap = void pre-produce... precise: failed QC
  returns to produce; order void allowed pre-produce only; scrapped
  material handled as loss at finish with approval).

## 2. Schema (migration 0014_manufacturing)

- `counters` += MO.
- `manufacturing_orders(id, number MO-000001 UNIQUE, type
  CUSTOMER/INTERNAL, customer_id NULL FK, branch_id FK, design TEXT,
  description, due_at NULL, status
  DRAFT/ALLOCATED/IN_PRODUCTION/QC_PASSED/QC_FAILED/COMPLETE/VOID,
  labour_cents DEFAULT 0, making_cents DEFAULT 0, stone_cost_cents
  DEFAULT 0, loss_mg DEFAULT 0, loss_reason NULL, created_at, created_by)`.
- `manufacturing_materials(id, order_id FK, lot_batch_id FK,
  lot_number, fine_mg allocated)`.
- `manufacturing_outputs(id, order_id FK, product_id FK UNIQUE, gross_mg,
  stone_mg, net_mg, cost_cents)`.
- New perms `mfg:view/create/edit/approve` (53 total): owner all; manager
  all; manufacturing_staff view/create/edit (first real grants);
  gold_officer view; inventory view; accountant view/export; others none.

## 3. Flow, reconciliation, costing

- `POST /manufacturing/orders` → DRAFT. `POST .../materials` (lot refs +
  fine; ≤ lot remaining = lot fine − allocated across non-void orders;
  →ALLOCATED). `POST .../produce` (outputs[] full specs + labour/making/
  stones + loss_mg + loss_reason if loss>0; loss% over
  `mfg_loss_approve_pct` default 3 needs mfg:approve approver ≠ actor;
  →IN_PRODUCTION). `POST .../qc` (pass →QC_PASSED; fail+reason
  →QC_FAILED; produce again allowed). `POST .../finish` (→COMPLETE):
  creates JW- products (cost = allocated-fine share × board rate at finish
  + labour/making/stones share), INTAKE rows, order COMPLETE.
- Reconciliation: allocated fine == Σ output fine + loss else VALIDATION.
- Gold ledger (at finish): MANUFACTURING_INPUT per lot, MANUFACTURING_OUTPUT
  per product, LOSS if >0 — plus allocation-time MANUFACTURING_INPUT?
  Decision: ledger writes happen once at finish (allocation is a reservation,
  not a movement; reservations visible via WIP report). Adjust: single
  posting point at finish.
- `PATCH .../void` pre-produce only (material rows deleted = allocation
  released) + reason.
- `GET /manufacturing/orders` (filters status/type/branch/customer),
  `GET /manufacturing/orders/:id` (full detail + ledger).

## 4. Lineage, UI, reports

- gold service: MO node kind; lot → order edges (via materials), order →
  product edges (via outputs). Lineage viewer unchanged in shape.
- UI Manufacturing section: Orders list/create, detail stepper
  (scan-add lots by lot number, produce form with live reconciliation
  preview, QC, finish, void), lineage chain.
- Reports: summary (counts by status, gold in/out/loss, labour) + WIP list.
  Dashboard "Gold in manufacturing" = WIP allocated fine.

## 5. Data flow example

Order for 2 rings, lots 5,000 + 3,000mg fine; outputs 4,500 + 3,000mg;
loss 500mg (6.25% → approval + "filing loss"). Finish: products cost =
share of 8,000mg × board + labour/making/stones; ledger 2×INPUT, 2×OUTPUT,
1×LOSS; audit; COMPLETE.

## 6. Testing

Vitest: reconciliation balance rule, threshold math.
Live gate: full order flow; ledger rows; over-threshold without approval
403; rework loop (fail → produce → pass); void releases lots; lineage
lot→MO→products; reports hand-verified; cashier cannot create.

## 7. Out of scope

Artisan tracking, refining fees in financial books, repairs module,
multi-output lots split across orders (one lot per order line... precise:
a lot MAY split across orders; remaining tracked — supported).

## 8. Self-review

- No TBD/TODO; thresholds, postings, grants explicit.
- Consistent: staged pipeline, batch+audit, journal-style validation,
  perm gating, scan-first UI — all extend existing patterns; single
  ledger-posting point avoids double-counting reservations.
- Single plan: manufacturing vertical only.
- Unambiguous: cost basis (board rate at finish), lot-split support,
  void scope, QC loop fixed.
