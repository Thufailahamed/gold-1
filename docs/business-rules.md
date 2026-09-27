# GoldOS Business Rules

Business rules are configuration, not code. Anything on this list MUST live in
the `settings` table (typed key/value) and never be hard-coded:

- Gold prices / daily gold rates
- Purity / karat definitions
- Making-charge formulas
- Wastage and loss allowances
- Discount limits
- Payment methods
- Product categories
- Expense categories

## Phase-1 enforced rules

- Sessions: 12h idle expiry, 7d absolute expiry.
- Users cannot deactivate themselves; deactivation requires a reason and is
  audit-logged. No hard deletes of users, branches, or any business record.
- Branch codes are unique; branch membership scopes what non-admin users see.
- Every write batches the business change with its `audit_logs` row — if the
  audit write fails, the whole mutation fails.
- Updates to branches and settings record prev/new values plus an optional reason.

## Integrity rules (apply from Phase 2 onward)

- Financial, gold, and inventory movements are atomic (`db.batch`).
- Corrections use VOID / CANCEL / REVERSE / ADJUSTMENT with user + timestamp +
  reason (+ approval where required), never DELETE.
