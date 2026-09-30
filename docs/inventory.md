# GoldOS Inventory

Ledger-first stock tracking. Current status is cached on `products.status`
but may only change inside a stock-movement batch — never by direct update.

## Movements (append-only)

`stock_movements`: product, type (INTAKE, TRANSFER_OUT, TRANSFER_IN, RETURN,
RESTOCK, SALE_OUT, LOSS, VOID), from/to status, from/to branch, weight snapshot (mg), reason,
actor, timestamp. No UPDATE or DELETE; corrections via VOID + recreate.

## Transition allowlist (internal)

| From | Allowed to |
|---|---|
| IN_STOCK | TRANSFER_PENDING, RETURNED, LOST, VOID, SOLD |
| TRANSFER_PENDING | IN_STOCK (completes with to-branch) |
| RETURNED | IN_STOCK (RESTOCK movement), VOID |
| SOLD | RETURNED (via sales returns only) |
| LOST, VOID | (terminal) |
| RESERVED, IN_REPAIR, IN_MANUFACTURING, MELTING, MELTED | locked → 409 TRANSITION_LOCKED |

SOLD unlocks with POS; MELTING/MELTED with melting; IN_REPAIR with repairs;
IN_MANUFACTURING with manufacturing; RESERVED with sales/orders.

## Public `/inventory/movements` guard (ledger safety)

Direct `POST /inventory/movements` allows only restocks and same-branch
moves: `IN_STOCK→TRANSFER_PENDING` (same branch only),
`IN_STOCK→RETURNED`, `RETURNED→IN_STOCK`. Cross-branch `TRANSFER_PENDING`
is refused with 409 (use `POST /transfers`). `SOLD` is refused (use POS),
`LOST` is refused (use `POST /counts/:id/approve` which posts the full
gold + journal path), `VOID` is refused (use `PATCH /products/:id/void`),
and any move from `SOLD` is refused (use `POST /sales/returns`).

Sales returns post a `gold_ledger` `RETURN` row (`sale:` → `branch:`) so
`gold_stock_consistency` stays green; `heldGold` counts `RETURNED` (same
set the monthly valuation counts). Counts `approve` requires a second
person who is neither the opener nor the majority scanner.

## Branch scoping

Stock, insights and movement history (`/inventory/*`), counts, transfers and
discrepancy reports only show the caller's branches (`branch_members`);
`branches:manage` sees all. Acting on a count needs membership of its branch.
Transfers: request from either branch; approve, dispatch, recall and cancel
at the sending branch; receive at the receiving branch.

## Stock counts (`/counts`, web: /inventory/counts)

Snapshot of IN_STOCK pieces in scope at start; one OPEN count per scope.
Counted pieces are locked (409 TRANSITION_LOCKED) against sale, transfer,
movement and void until the count closes. A scan is OK only when the piece is
in the snapshot; a real piece that is not (other branch, out of scope) is
UNEXPECTED; a repeat is DUPLICATE. Approval (second person holding
`gold:manage`, not the opener or majority scanner) validates every missing
line first — book cost known, rate published — then posts all of them in one
batch: LOST + LOSS movement + gold ADJUSTMENT + DR 5300 / CR 1100 at book
cost (no journal for an explicit zero cost). Investigation notes and the list
of written-off pieces (`postedIds`) are kept in `result_json`.

## Transfers (`/transfers`, web: /inventory/transfers)

Request → approve (sending-branch member with `products:cancel`, not the
requester) → dispatch (TRANSFER_PENDING, gold TRANSFER row) → receive by scan
(IN_STOCK at receiver) or recall. A piece can be on only one open transfer.
Numbers (TRF-) are reserved atomically.

## Discrepancies (web: /inventory/discrepancies)

Live reads per branch: missing, unexpected, duplicate scans, transfers in
transit past `transfer_unreceived_days` (default 3), gold consistency, and
transfers whose reconciliation has warnings. CSV needs `audit:export`.

## Valuation

Stock summaries report weights (mg) and fine gold (mg) exactly; value is
weight × current rate at read time (making charges excluded from valuation).
All math in minor units, rounded once.

## Traceability

Every movement writes an audit row in the same batch. Movement history per
product is visible on the product detail page; global history with
product/branch/type filters on the inventory screen.
