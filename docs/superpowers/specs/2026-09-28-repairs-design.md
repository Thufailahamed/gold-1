# GoldOS — Repairs Design (Slice 1 of Repairs & Custom Orders)

Date: 2026-09-28
Status: Approved (job document, 4000 revenue, dedicated table, cancel until collection)
Scope: Repair intake → technician → repair → QC → ready → collection with payment. Custom orders follow as Slice 2. No advances on repairs; no inventory or gold postings.

## 1. Context

No repair workflow exists: the only trace is the `IN_REPAIR` product status, which the transition allowlist locks and nothing ever writes. Manufacturing CUSTOMER orders exist but their finish mints products and capitalizes gold — wrong semantics for fixing customer property. The sale/payment machinery (`buildEntryStmts`, 1000/1020/bank/1200 legs, 4000 revenue) is the tested path money must travel.

User-confirmed decisions:
- Repairs first; custom orders second.
- Collection revenue posts to 4000 (no chart change).
- Customer items live in a dedicated table, never in `products`.

## 2. Schema (migration `0024_repairs`)

```sql
CREATE TABLE repairs (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE, -- RPR-000001 via counters
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  item_desc TEXT NOT NULL,
  weight_mg INTEGER NOT NULL,
  condition_in TEXT NOT NULL,
  condition_out TEXT,
  repair_type TEXT NOT NULL,
  estimate_cents INTEGER NOT NULL,
  actual_cents INTEGER,
  technician_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'RECEIVED', -- RECEIVED | IN_PROGRESS | QC | READY | COLLECTED | CANCELLED
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rep_status ON repairs(status);
CREATE INDEX idx_rep_branch ON repairs(branch_id);
CREATE INDEX idx_rep_customer ON repairs(customer_id);

CREATE TABLE repair_events (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL REFERENCES repairs(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_re_repair ON repair_events(repair_id);

INSERT INTO counters (name, next) VALUES ('RPR', 1);
```

- Weight is a snapshot at intake (mg, minor units like everything else). Estimate and actual are both stored; the ticket shows both, never one silently replacing the other.
- `repair_events` is append-only: every transition writes a row in the same batch. History is never edited.

## 3. State transitions (one batch each, always with audit)

- `GET /repairs` (`sales:view`): filters branch/customer/status, paginated like other lists.
- `GET /repairs/:id` (`sales:view`): job + events + payment entry link.
- `POST /repairs` (`sales:create`): `{ customerId, branchId, itemDesc, weightG, conditionIn, repairType, estimateLkr }`. Validates customer + branch active. Status RECEIVED.
- `POST /repairs/:id/assign { technicianId }` (`sales:create`): RECEIVED → IN_PROGRESS. Technician must be an active user.
- `POST /repairs/:id/qc { pass: boolean, reason? }` (`sales:approve`): IN_PROGRESS → QC is implicit on repair completion... transitions: IN_PROGRESS → QC (repair done, awaiting check) via `POST /repairs/:id/finish-repair` (`sales:create`); QC → READY on pass, QC → IN_PROGRESS on fail (reason required, same shape as manufacturing QC).
- `POST /repairs/:id/collect { payments[], actualLkr? }` (`sales:create`): READY → COLLECTED. Requires the payment batch (below) in the same atomic commit — unpaid collection is refused with 409. Sets `condition_out` and `actual_cents` (defaults to estimate when not overridden; the override is stored, not silent).
- `POST /repairs/:id/cancel { reason }` (`sales:cancel`): from any state except COLLECTED. A collected repair is never cancelled — correction is a reversing entry.
- Skipped states are refused (RECEIVED → READY is 409). Every transition writes a `repair_events` row + audit in the same batch.

## 4. Payment posting

Collection builds one journal batch via `buildEntryStmts` (shared helper): DR per payment leg (`1000` cash / `1020` card / named bank account / `1200` receivable with the customer party; split payments allowed) / CR `4000` for the actual cost. No 5000/1100 legs — nothing left inventory. Card legs clear through `1020`; acquirer fees stay in the normal settlement flow. `ref_entity: 'repair'`, `source_module: 'sales'`, branch = repair branch (closed-day lock applies automatically). Because the cash leg carries a new `ref_entity`, `repair` is added to `KNOWN_CASH_REFS` (label "Repair collections", cash-in side like `sale_invoice` — money posts only at collection, so there is no outflow leg) so the day-close unclassified guard names it instead of blocking the close. Intake, assignment, and QC post no money.

## 5. Permissions and scoping

Reuse `sales:*` (permission count stays 53): view `sales:view`, intake/assign/finish/collect `sales:create`, QC `sales:approve`, cancel `sales:cancel`, export `sales:export`. Branch member rule applies; listing filters by branch/customer/status. No new permission, no matrix migration.

## 6. No-fabrication guards

- The ticket carries estimate AND actual; collection without an explicit actual books the estimate and labels it `billed: "estimate"`.
- Intake creates zero `products` rows and zero gold rows — verified by test, not by convention.
- Cancelled/collected states are terminal; history is append-only.

## 7. Testing

- State machine: skip-step → 409; cancel after COLLECTED → 409; QC-fail returns to IN_PROGRESS with reason; collect-unpaid → 409.
- Payment batch balances (DR == CR) with no 5000/1100 legs; split payments sum to actual.
- Intake creates no products/gold-ledger/journal rows.
- Perm gates per §5; branch scoping (foreign branch without manage → 403).

## 8. Out of scope (Slice 2)

- Custom orders (quotation, advances, customer/shop/mixed gold, manufacturing link, delivery + balance payment, gold lineage).
