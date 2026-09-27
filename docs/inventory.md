# GoldOS Inventory

Ledger-first stock tracking. Current status is cached on `products.status`
but may only change inside a stock-movement batch — never by direct update.

## Movements (append-only)

`stock_movements`: product, type (INTAKE, TRANSFER_OUT, TRANSFER_IN, RETURN,
LOSS, VOID), from/to status, from/to branch, weight snapshot (mg), reason,
actor, timestamp. No UPDATE or DELETE; corrections via VOID + recreate.

## Transition allowlist (this phase)

| From | Allowed to |
|---|---|
| IN_STOCK | TRANSFER_PENDING, RETURNED, LOST, VOID |
| TRANSFER_PENDING | IN_STOCK (completes with to-branch) |
| RETURNED | IN_STOCK, VOID |
| LOST, VOID | (terminal) |
| RESERVED, SOLD, IN_REPAIR, IN_MANUFACTURING, MELTING, MELTED | locked → 409 TRANSITION_LOCKED |

SOLD unlocks with POS; MELTING/MELTED with melting; IN_REPAIR with repairs;
IN_MANUFACTURING with manufacturing; RESERVED with sales/orders.

## Valuation

Stock summaries report weights (mg) and fine gold (mg) exactly; value is
weight × current rate at read time (making charges excluded from valuation).
All math in minor units, rounded once.

## Traceability

Every movement writes an audit row in the same batch. Movement history per
product is visible on the product detail page; global history with
product/branch/type filters on the inventory screen.
