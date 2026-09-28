# GoldOS — Discrepancy Reports Design (Slice 3 of Advanced Inventory)

Date: 2026-09-28
Status: Approved (live on-demand, 3-day unreceived default, aggregate summary)
Scope: Five read-only reports — missing jewellery, unexpected stock, duplicate scans, unreceived transfers, aggregate stock discrepancies. No new tables, no writes, no scheduled jobs. Branch-stock view follows as Slice 4.

## 1. Context

All sources exist on main: count sessions freeze `expected_json` and log `count_scans` with OK/DUPLICATE/UNEXPECTED flags (`0022_stock_count`, `counts.ts`); transfers track per-line PENDING/IN_TRANSIT/RECEIVED/RECALLED (`0023_transfer_docs`, `transfers.ts`); `reconcile.ts` exposes `heldGoldMg` and the directional gold-ledger sum behind `gold_stock_consistency`; `reconcileTransfer` returns per-transfer `warnings[]`. Nothing here needs a new write path — only honest reads.

User-confirmed decisions:
- Reports compute live from current tables on every request.
- An IN_TRANSIT line is "unreceived" after `transfer_unreceived_days` (settings, default 3).
- The discrepancies report aggregates the other four sources plus ledger cross-checks with drill-down links.

## 2. Endpoints (`/api/v1/discrepancies`, `products:view`)

- `GET /missing?branchId=` — unresolved missing lines: live `compareCount` over OPEN counts (missing minus rescanned) plus COMPLETE counts' `result_json.missing` with the `posted` flag from the same payload. Row: `{ countId, productId, barcode, productName, daysOpen, status, posted }`.
- `GET /unexpected?branchId=` — `count_scans` with flag UNEXPECTED, grouped by count. Row: `{ countId, barcode, scannedAt, scannedBy }`. A later-identified barcode stays listed until its count completes — the report never edits history.
- `GET /duplicates?branchId=` — flag DUPLICATE, same shape. Duplicates are scan hygiene, not stock movement: the report says so in its `note`.
- `GET /unreceived?branchId=` — `transfer_lines` IN_TRANSIT with age ≥ threshold days. Age basis: the line's TRANSFER_OUT `stock_movements.created_at` for that product + transfer number (dispatch time, audited — not the request-time `transfer_lines.created_at`). Row: `{ transferId, number, barcode, productId, fromBranch, toBranch, ageDays }`. RECEIVED/RECALLED lines never appear.
- `GET /summary?branchId=` — `{ missing: n, unexpected: n, duplicates: n, unreceived: n, gold: [{ branchId, passed, differenceMg }], transfers: [{ transferId, number, warnings[] }] }`, where gold reuses the `gold_stock_consistency` computation (directional ledger sum vs `heldGoldMg`, exact mg, 0 tolerance) and transfers lists only documents with non-empty `reconcileTransfer` warnings. Every row carries its source link (`countId` → compare, `transferId` → reconcile).
- Branch filter required without `branches:manage` (same rule as counts, transfers, monthly). `?format=csv` on each endpoint requires `audit:export` and prepends `generated_at, branch, source: live-read` so exports can't be mistaken for frozen statements.

## 3. Threshold setting

`transfer_unreceived_days`: typed number in `settings`, default 3, read via `getSetting` with fallback (same pattern as `gold_adjust_approve_mg` and expense thresholds). Tunable by `settings:edit` holders without code changes. Age in whole days; a line exactly at the threshold counts as unreceived ("at N days it is N days late" — documented on the endpoint).

## 4. No-fabrication guards

- Empty sources return `[]` with `hasData: false`; the summary shows "no open discrepancies", never zero-implied health claims beyond what was checked.
- Resolved lines (rescanned missing, received transfers) disappear because the underlying state changed — the report explains this in its `note`, it does not rewrite rows.
- Gold differences report exact milligrams with 0 tolerance; money never appears (no weight↔money mixing, per the ledger rule).
- CSV preamble marks every export as a live read with timestamp.

## 5. Testing

- Bucket test: lines aged 2/3/4 days at default 3 → only 3+ flagged; custom setting honored.
- Missing test: rescan-resolved line excluded; posted shortage still listed until count completes.
- Unreceived test: RECEIVED and RECALLED lines excluded; PENDING lines excluded (never dispatched).
- Summary test: clean branch → all-pass with empty lists; seeded TRANSFER_OUT without TRANSFER_IN on RECEIVED line → warning surfaced.
- Perm tests: list without branch and without `branches:manage` → 403; CSV without `audit:export` → 403.

## 6. Out of scope (follow-up specs)

- Branch-stock consolidated read view (Slice 4).
- Monthly Slices 2–3 (aging + valuation, CSV exports + dashboard).
- Any write path from these reports (all resolution happens in counts/transfers endpoints).
