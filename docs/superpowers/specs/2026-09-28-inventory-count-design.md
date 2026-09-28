# GoldOS — Stock Count Design (Slice 1 of Advanced Inventory)

Date: 2026-09-28
Status: Approved (count-first, full ledger posting, lock in-scope)
Scope: Stock-count workflow only — start → scan → compare → investigate → approve adjustment. Transfer workflow upgrade, missing-item reports, and branch-stock view are follow-up specs in that order.

## 1. Context

Inventory moves through append-only `stock_movements` with a transition allowlist (`inventory.md`); transfers today complete instantly in one batch (`TRANSFER_OUT` + `TRANSFER_IN` + gold `TRANSFER` row, `inventory.ts`) with no in-transit state. Counts do not exist: there is no session, no snapshot, no scan log, no compare, and no count-driven adjustment path. `stockSummary` covers IN_STOCK products only.

User-confirmed decisions:
- Slice 1 is the count workflow; transfers/reports/branch view follow as separate specs.
- An approved missing piece posts the full ledger path (product → LOST + LOSS movement + gold-ledger ADJUSTMENT + journal DR 5300 / CR 1100 at book cost), reusing the existing gold-adjustment rule including refusal when no effective rate exists.
- In-scope items lock while a count is open: sales/transfers of counted pieces fail with 409 `TRANSITION_LOCKED`.

## 2. Schema (migration `0022_stock_count`)

```sql
CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  scope TEXT NOT NULL, -- FULL | CATEGORY | BRANCH | LOCATION
  scope_ref TEXT,      -- category_id | branch_id | location string | NULL for FULL
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | COMPLETE | CANCELLED
  expected_json TEXT NOT NULL, -- frozen barcode list at start
  result_json TEXT,             -- frozen compare at approve/cancel
  opened_by TEXT REFERENCES users(id),
  closed_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_sc_open_scope ON stock_counts(branch_id, scope, COALESCE(scope_ref,'')) WHERE status='OPEN';
CREATE INDEX idx_sc_status ON stock_counts(status);

CREATE TABLE count_scans (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES stock_counts(id),
  barcode TEXT NOT NULL,
  product_id TEXT REFERENCES products(id),
  flag TEXT NOT NULL DEFAULT 'OK', -- OK | DUPLICATE | UNEXPECTED
  scanned_by TEXT REFERENCES users(id),
  scanned_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cs_count ON count_scans(count_id);
```

- One open count per scope: the partial unique index refuses a second OPEN count on the same branch+scope+ref with 409. FULL scope uses `scope_ref NULL`.
- `expected_json` freezes the count's truth at start (product ids + barcodes IN_STOCK in scope). The compare reads the snapshot, never live `products` — a recount six months later is a record, not a guess.
- Scans are append-only. Cancel keeps the scan log and writes `result_json`; the rows are never deleted.

## 3. Lock

While a count is OPEN, every in-scope product id in `expected_json` is locked:
- `recordMovement`, sale `receiveSale`, and transfer paths check open counts covering the product and throw `TRANSITION_LOCKED` (409) — the same code the allowlist already returns, so clients need no new error handling.
- Out-of-scope items trade normally. Cancel or approve releases the lock.
- The check lives in one helper (`assertCountLock(db, productId)`) called by all three paths — one guard, not three chances to forget one (same reasoning as the closed-day lock in `buildEntryStmts`).

## 4. Scan → compare → investigate → approve

- `POST /counts` (`products:edit`): `{ branchId, scope, scopeRef? }`. Validates branch/category, snapshots expected, returns `{ id, expectedCount }`.
- `POST /counts/:id/scans` (`products:edit`): `{ barcode }`. Barcode lookup is case-insensitive across PRD-/JW-/OG- (same as the scan screen). Unknown barcode → UNEXPECTED row with `product_id NULL`. Repeat barcode in the same count → DUPLICATE row (compare counts it once). Returns `{ flag }`.
- `GET /counts/:id/compare` (`products:view`): pure function `compareCount(expected[], scans[]) → { matched, missing[], unexpected[], duplicates[], matchedCount }`. No writes; safe to re-run during investigation.
- Investigate: `POST /counts/:id/notes { productId, note }` attaches a note to a missing line (stored in `result_json` working copy, not a product edit). A re-scan that resolves a line flips it to matched — proven by the scan row, not by editing.
- `POST /counts/:id/approve { reason, approvedBy }` requires `products:cancel` on the caller; the named `approvedBy` user must hold `gold:manage` and be neither the opener nor the majority scanner — the expenses/day-reopen second-person rule. For each still-missing line, one atomic batch: `UPDATE products SET status='LOST'`, LOSS `stock_movements` row, gold-ledger ADJUSTMENT row, journal DR 5300 / CR 1100 at the product's `cost_cents` book cost, plus audit — reusing the gold-adjustment path including its refusal when no effective rate exists for the purity. UNEXPECTED lines post nothing (a surplus is investigated, not booked). Count → COMPLETE with frozen `result_json`; lock releases.
- `POST /counts/:id/cancel { reason }` (`products:edit`): releases lock, freezes `result_json`, keeps everything. A wrong approval is corrected by a reversing entry per the ledger rule — never an edit or delete.
- Barcodes are never changed by any of this: a transferred or counted item retains its barcode end to end.

## 5. Branch scoping (never mix stock)

Every count names one `branch_id`. FULL scope means the whole of that branch, not the whole shop. List/compare endpoints require `branchId` unless the caller holds `branches:manage` (same rule as the monthly report); the owner passes all branches by iterating branches, never by a mixed total. Each branch's jewellery/gold/cash/bank/staff/sales/purchases stay per-branch until the branch-stock spec consolidates the read view.

## 6. No-fabrication guards

- Compare derives only from snapshot + scan rows. An empty count returns zeros with `hasData: false`-style `matchedCount: 0`, never a fabricated "all matched".
- Approval posts only missing lines with a reason and a second person; a count with zero missing closes with no postings and says so.
- The surplus path posts nothing: unexpected scans are reported, not booked into stock or profit.

## 7. Testing

- Pure `compareCount` unit tests (missing/unexpected/duplicate/empty/resolved-by-rescan) in `packages/shared` or the service test file.
- Lock tests: sale + `recordMovement` transfer of an in-scope item → 409; out-of-scope item → ok; after cancel → ok.
- Approval tests: one missing piece → LOST + LOSS movement + balanced journal (DR 5300 == CR 1100 at `cost_cents`); UNEXPECTED-only count → COMPLETE with zero postings; self-approval → 403; second OPEN count on same scope → 409.
- Route perm tests: view/edit/cancel gates per §4.

## 8. Out of scope (follow-up specs)

- Transfer workflow (request → approval → dispatch → in-transit → receive → reconciliation); barcode retention already holds today and is preserved here.
- Missing-item / discrepancy scheduled reports (missing jewellery, unexpected stock, duplicate scans, unreceived transfers, stock discrepancies).
- Branch-stock consolidated read view (jewellery, gold, cash, bank, staff, sales, purchases per branch + all-branches).
