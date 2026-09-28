# GoldOS — Gold Ledger & Melting Design

Date: 2026-09-28
Status: Approved
Scope: Unified gold_ledger with backfill, melting batches (old-gold in,
refined lots out) with assay + approved reconciliation, lineage walk,
stock dashboard, UI. No manufacturing linkage, no refining-fee accounting.

## 1. Context

Gold moves through gold_movements (IN/OUT, product- or old-gold-linked) but
the table lacks source/destination/notes/branch and covers only sales,
returns, and old-gold purchases. Melting statuses exist but are locked with
no module behind them. This spec adds the unified ledger and the melting
pipeline. Approach: new backfilled table + batch pipeline (A); invisible
adjustments (B) and full rewrite (C) rejected.

Decisions (user-confirmed):
- New gold_ledger + backfill; gold_movements stays until cutover.
- Melt output = refined lots (grain/bar with assay purity).
- Reason always; approval over loss % (default 2).
- Melting consumes old-gold items only.

## 2. Gold ledger (migration 0013_goldledger)

- `gold_ledger(id, occurred_at, branch_id FK, source TEXT, destination
  TEXT, type [PURCHASE|OLD_GOLD_PURCHASE|SALE|MELTING_INPUT|MELTING_OUTPUT|
  MANUFACTURING_INPUT|MANUFACTURING_OUTPUT|TRANSFER|RETURN|ADJUSTMENT|LOSS|
  RECOVERY], weight_mg, permille, fine_mg, ref_entity, ref_id, product_id
  NULL FK, old_gold_id NULL FK, user_id FK, notes, created_at, created_by)`
  — append-only; indexes (branch,time), (ref), (product), (old_gold).
- Backfill from gold_movements: sale_invoice→SALE, sale_return→RETURN,
  old_gold_purchase→OLD_GOLD_PURCHASE; source/destination strings
  (`customer:{id}`, `branch:{id}`); occurred_at = created_at.
- `postGoldStmts(db, {entries})` validates known type, non-negative
  weights, fine consistency (recompute + reject mismatch > 1mg rounding).
- `POST /gold/ledger/adjustments` (type ADJUSTMENT/LOSS/RECOVERY, reason,
  approval over threshold) — perm gold:manage.
- `GET /gold/ledger` (filters type/branch/ref/product/oldgold/date),
  `GET /gold/lineage?refEntity=&refId=`.
- New perms `gold:view`, `gold:manage` (49 total): view =
  owner/manager/accountant/gold_officer/cashier; manage =
  owner/manager/gold_officer.

## 3. Melting batches (same migration)

- `melting_batches(id, number MELT-000001 UNIQUE via counters MELT,
  branch_id FK, status DRAFT/LOCKED/MELTED/ASSAYED/APPROVED/VOID,
  input_fine_mg, output_fine_mg, waste_mg, loss_mg, recovery_mg,
  difference_reason, approved_by NULL FK, created_at, created_by)`,
  `melting_inputs(id, batch_id FK, old_gold_id FK UNIQUE, gross_mg,
  net_mg, fine_mg)`, `melting_outputs(id, batch_id FK, lot_number
  MLT-{n}-01, weight_mg, permille, fine_mg, output_type grain/bar)`.
- Flow: create (DRAFT) → add items (scan OG-, AVAILABLE only →
  RESERVED_FOR_MELTING + audit) → lock (frozen) → melt (output weight +
  assay permille + waste; fine/out/difference computed; →MELTED; ASSAYED
  folded into melt record — no separate assay state transition, assay
  fields on batch) → approve (reason always; loss% >
  `melt_loss_approve_pct` default 2 → gold:manage approver ≠ actor;
  writes MELTING_INPUT per item, MELTING_OUTPUT per lot, LOSS/RECOVERY as
  applicable; items →MELTED; →APPROVED). Void pre-lock only + reason.
- `GET /melting/batches` (filters status/branch), `GET /melting/batches/:id`
  (items + tests + outputs + ledger rows), label print (MELT number SVG via
  existing label helper? Labels are Code128 of text — reuse bwip-js with
  MELT text. Yes.)

## 4. Lineage, stock, UI

- `GET /gold/lineage`: ref-graph walk both directions over gold_ledger +
  linking tables (sales_items, converted_product_id, melting I/O,
  purchase_invoice_items); returns ordered nodes `{kind, id, label, link}`.
- `GET /gold/stock?groupBy=purity|branch|stage`: stage buckets old_gold
  (PURCHASED/AVAILABLE fine), melting (LOCKED/MELTED input fine),
  refined (output lots fine), for_sale (IN_STOCK products fine).
- UI: Gold section — Ledger (filters + CSV), Batches (list/create/detail
  with scan-add + lock/melt/approve dialogs + live difference), Stock
  dashboard (stage cards + tables), lineage chain component in product +
  old-gold detail pages.

## 5. Data flow example

2 OG items (4,580 + 3,200mg fine) melt → output 7,400mg @916 assay, waste
200mg: loss = 7,780 − 7,400 − 200 = 180mg (2.3% → approval + reason
"refining loss"). Batch writes: 2× MELTING_INPUT, 1× MELTING_OUTPUT,
1× LOSS, items →MELTED, audit → APPROVED.

## 6. Testing

Vitest: fine recompute tolerance, difference math, threshold rule.
Live gate: full melt flow; ledger shows all rows; over-threshold without
approval 403; void post-lock 409; double-melt same item (UNIQUE) 409;
lineage OG→batch→lot walks both ways; reports hand-verified; old flows
(sale/purchase/oldgold) still post gold_movements.

## 7. Out of scope

Manufacturing linkage (MO- statuses stay locked), refining fees in
financial books, assay-certificate PDFs, camera scanning.

## 8. Self-review

- No TBD/TODO; thresholds, postings, grants explicit.
- Consistent: staged pipeline, batch+audit, journal-style validation,
  perm gating, scan-first UI — all extend existing patterns; ASSAYED kept
  as data (fields) not a transition to avoid a no-op state.
- Single plan: ledger + melting only.
- Unambiguous: backfill mapping, lot numbering, approval identity,
  difference formula fixed.
