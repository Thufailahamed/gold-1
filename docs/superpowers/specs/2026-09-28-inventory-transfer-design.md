# GoldOS — Stock Transfer Workflow Design (Slice 2 of Advanced Inventory)

Date: 2026-09-28
Status: Approved (multi-item document, sending-branch second-person approval, locked in transit at sender, partial receive + recall)
Scope: Transfer request → approval → dispatch → in-transit → receive → reconciliation with barcode retention. Discrepancy reports and the branch-stock view are follow-up specs in that order.

## 1. Context

Transfers today are instant and single-item: `recordMovement` to TRANSFER_PENDING writes TRANSFER_OUT + TRANSFER_IN movements, flips `branch_id`, and posts one gold TRANSFER row in a single batch (`inventory.ts`). There is no request, no approval, no in-transit state, no per-line tracking, and no recall. Slice 1 (stock counts, `0022_stock_count`) added `assertCountLock`, which the dispatch path reuses.

User-confirmed decisions:
- One transfer document carries many barcodes; receipt confirms per barcode; leftover lines stay in-transit.
- Approval comes from the sending branch and never from the requester.
- In transit the item is TRANSFER_PENDING at the sender, unsellable and uncountable, until receipt flips it.
- The sender can recall an unreceived line; receive and recall are per-line.

## 2. Schema (migration `0023_transfer_docs`)

```sql
CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE, -- TRF-000001 via counters
  from_branch_id TEXT NOT NULL REFERENCES branches(id),
  to_branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED', -- REQUESTED | APPROVED | DISPATCHED | PARTIAL | COMPLETE | CANCELLED
  reason TEXT,
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tr_status ON transfers(status);
CREATE INDEX idx_tr_branches ON transfers(from_branch_id, to_branch_id);

CREATE TABLE transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  barcode TEXT NOT NULL, -- snapshot at request; the product row keeps the live barcode
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | IN_TRANSIT | RECEIVED | RECALLED
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_tl_transfer_product ON transfer_lines(transfer_id, product_id);
CREATE INDEX idx_tl_status ON transfer_lines(status);
```

- `counters` gains `TRF` (TRF-000001), bumped inside the request batch like PO/PINV/SINV.
- The header status is derived, never set directly: CANCELLED only from REQUESTED/APPROVED; DISPATCHED when lines leave PENDING; PARTIAL when at least one line is RECEIVED/RECALLED and at least one is IN_TRANSIT; COMPLETE when no line is PENDING/IN_TRANSIT.
- Barcodes are snapshots for the paper trail; the product row is the live record and is never rewritten by any transfer step.

## 3. State transitions (one batch each, always with audit)

- `POST /transfers` (`products:edit`): `{ fromBranchId, toBranchId, productIds[], reason? }`. Validates both branches active and distinct, every product IN_STOCK at the sender and not under an open count covering it (reuses the snapshot rule: counted items can't be requested). Writes header (REQUESTED) + lines (PENDING) + audit. Duplicate product in one document → 409.
- `POST /transfers/:id/approve { approvedBy }` (`products:cancel` on the caller): approver must be an active member of the sending branch (`branch_members`), hold `products:cancel`, and differ from the requester — else 403. Status → APPROVED. No stock moves.
- `POST /transfers/:id/dispatch` (`products:edit` at sender): requires APPROVED. Per line: re-check IN_STOCK at sender + `assertCountLock` (409 on a counted item), set product TRANSFER_PENDING (branch unchanged), write TRANSFER_OUT movement, write one gold TRANSFER row (source sender, destination receiver, ref `transfer_line`). Lines → IN_TRANSIT, header → DISPATCHED. One batch for the whole document; any failure rolls back all lines.
- `POST /transfers/:id/receive { barcodes[] }` (`products:edit` at receiver): per barcode (case-insensitive), line must be IN_TRANSIT: set product IN_STOCK + `branch_id` = receiver, write TRANSFER_IN movement. Lines → RECEIVED. Header re-derives (PARTIAL or COMPLETE). Unknown barcode → 400 with the offending code named; already-received barcode → idempotent ok.
- `POST /transfers/:id/recall { productIds[] }` (`products:edit` at sender): lines must be IN_TRANSIT: set product IN_STOCK at sender, write TRANSFER_IN movement (sender → sender, reason recall). Lines → RECALLED. Header re-derives.
- `POST /transfers/:id/cancel { reason }`: allowed only while no line has left PENDING (else 409 with guidance to recall). Header → CANCELLED; lines stay PENDING as the record. Nothing is deleted.
- The legacy instant path (`POST /inventory/movements` to TRANSFER_PENDING) is kept but now executes as a same-actor request+approve+dispatch+receive only when from and to branch are identical — any cross-branch instant transfer is refused with 409 CONFLICT and pointed at `/transfers` (409 keeps the existing `serviceError` mapping; no new error code).

## 4. Gold and money

- One gold TRANSFER row per dispatched line (source `branch:<from>`, destination `branch:<to>`), written at dispatch — not at receive — so `gold_stock_consistency` sees the movement once and the receiving branch's held-gold cross-checks pass on arrival. Receipt and recall write no gold rows, only stock movements.
- No journal entries: a transfer moves stock between branches of one shop, so no value changes hands (same principle as cash transfers resting in 1030 rather than touching profit).
- Reconciliation (`GET /transfers/:id/reconcile`, `products:view`): checks per line — exactly one TRANSFER_OUT movement; RECEIVED lines have exactly one TRANSFER_IN and product branch == receiver; IN_TRANSIT lines have product branch == sender and status TRANSFER_PENDING; barcode on product == line snapshot. Failures return 200 with `warnings[]` naming lines, never silent; a transfer with warnings cannot COMPLETE until resolved (receive/recall) or a `note` is recorded (the monthly-snapshot warnings rule).

## 5. Lock and count interplay

- TRANSFER_PENDING products fail the sale availability check (IN_STOCK required) and are excluded from count snapshots (IN_STOCK filter) — no new guards needed on those paths.
- Dispatch calls `assertCountLock` per line: an item frozen in an open count cannot be dispatched (409 `TRANSITION_LOCKED`).
- Starting a count whose scope contains TRANSFER_PENDING items excludes them silently — they are neither branch's shelf stock, and the snapshot records only what it froze.

## 6. Branch scoping (never mix stock)

Every transfer names both branches explicitly. Listing requires a branch filter (`fromBranchId` or `toBranchId`) unless the caller holds `branches:manage` (same rule as counts and monthly). No endpoint returns a mixed-branch total; the owner iterates branches.

## 7. No-fabrication guards

- Receive confirms only scanned barcodes; unscanned lines stay IN_TRANSIT and appear in the unreceived-transfer surface (Slice 3), never auto-completed.
- Partial states are explicit (PARTIAL) — a half-received document never reads as COMPLETE.
- Recall restores the sender visibly (RECALLED + movement), never by deleting the line.

## 8. Testing

- State machine: request → approve → dispatch → partial → complete; cancel after dispatch → 409; self-approval → 403; non-sender-member approval → 403; duplicate product → 409; unknown receive barcode → 400 naming the code.
- Ledger: one TRANSFER_OUT + one gold TRANSFER per dispatched line; receipt flips branch + TRANSFER_IN; recall restores sender + TRANSFER_IN; barcode identical from request to receipt.
- Lock: dispatch of a counted item → 409; sale of IN_TRANSIT item fails availability.
- Reconcile: crafted missing-TRANSFER_IN surfaces in `warnings[]`; clean transfer returns empty warnings.
- Legacy path: cross-branch instant transfer → 409 pointing at `/transfers`; same-branch → ok.

## 9. Out of scope (follow-up specs)

- Missing-item / discrepancy scheduled reports (missing jewellery, unexpected stock, duplicate scans, unreceived transfers, stock discrepancies) — the IN_TRANSIT leftovers feed them.
- Branch-stock consolidated read view.
