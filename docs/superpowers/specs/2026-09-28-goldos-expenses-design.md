# GoldOS — Expenses Design

Date: 2026-09-28
Status: Approved
Scope: Expense categories each owning a ledger account, expense entries with
branch, payment account, approval above a threshold, receipt upload to R2
above a threshold, and a cross-foot check. No recurring expenses, no
multi-currency, no petty cash, and no daily-closing screen — that is spec 4.

## 1. Context

Accounts 6000-6080 were seeded in the ledger-core work and nothing has ever
posted to them. There is no expenses module at all: no categories, no entry, no
receipt, no approval. Every expense a shop like this has — rent, power,
salaries, tools, transport, card fees — is either forgotten or tracked in a
pocket notebook, and the trial balance cannot show what the business actually
spent.

Approach: an expense is a document row plus one journal entry, following the
same pattern specs 1 and 2 established. The category owns the account, so the
P&L breaks out by category without any report having to guess how to split an
account.

Decisions (user-confirmed):
- The money moves in the books when the expense is **approved**, not when it is
  keyed.
- One account per category. No two categories share an account.
- A receipt is **required above a threshold**, optional below it.
- No recurring expenses. Rent and power are ordinary expenses recorded when
  paid.

## 2. Schema (migration `0019_expenses`)

```sql
CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_code TEXT NOT NULL UNIQUE REFERENCES chart_of_accounts(code),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  incurred_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  vendor TEXT,
  description TEXT NOT NULL,
  payment_account_code TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id),
  status TEXT NOT NULL DEFAULT 'POSTED',
  receipt_key TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER,
  rejection_reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_exp_date   ON expenses(branch_id, incurred_on);
CREATE INDEX idx_exp_status ON expenses(status, incurred_on);
CREATE INDEX idx_exp_cat    ON expenses(category_id, incurred_on);

INSERT INTO counters (name, next) VALUES ('EXP', 1);
```

`status` is `PENDING_APPROVAL`, `POSTED` or `REJECTED`. There is no `VOID`: a
rejected expense stays visible with its reason, per the append-only rule. There
is no `DRAFT` either — the row and, when approval is not required, the journal
entry land in one batch.

`payment_account_code` is the **resolved** account, `1000` for cash or the bank
account's own code. It is stored rather than recomputed so the historical
record still says where the money came from after a bank account is renamed.
`bank_account_id` is kept alongside for the UI and is `NULL` for cash.

### Categories

Nine are seeded against the accounts the ledger-core work already created, so
the shop has a usable set on day one and no account sits empty and unexplained:

| Account | Category |
|---|---|
| 6000 | Rent & Rates |
| 6010 | Utilities |
| 6020 | Salaries & Wages |
| 6030 | Repairs & Maintenance |
| 6040 | Transport & Delivery |
| 6050 | Marketing & Advertising |
| 6060 | Bank & Card Charges |
| 6070 | Office & Consumables |
| 6080 | Other Expenses |

A new category takes the **lowest unused code in 6090-6199**, the same rule
bank accounts use for 1011-1099, and creates the ledger account in the same
batch. When the range is exhausted the request fails with `VALIDATION` rather
than inventing a code outside the expense block.

A category with journal entries cannot be deactivated — its history would stop
adding up.

## 3. Thresholds

Two settings, both following the `getSetting(db, key)` + fallback pattern the
other modules use:

| Setting key | Default | Meaning |
|---|---|---|
| `expense_approval_threshold_cents` | `500000` (LKR 5,000) | above this, approval is required before the entry posts |
| `expense_receipt_required_cents` | `1000000` (LKR 10,000) | above this, a receipt must be attached before the entry can be approved |

Both are per-shop configuration, not code. A shop that wants two people on
everything sets the approval threshold to `1`.

## 4. The posting

`DR <category account> / CR <payment account>`

The cost lands on the branch that **incurred** it. The money comes from
wherever the shop paid it, which is a different question — a head-office
invoice paid from the main bank is a cost of the branch that spent it, not a
movement of that branch's cash. The journal entry's `branch_id` is the
incurred branch; the credit leg's account is resolved independently.

At or below the approval threshold the expense is created and posted in **one
batch**, so the row and the entry cannot disagree. Above it, the row is
created `PENDING_APPROVAL` with no entry, and `POST /expenses/:id/approve`
writes the entry.

Approval requires `approver ≠ requester` and the approver to hold
`accounts:manage`, the same shape as `requireApprover` in sales and
`requireGoldApprover` in gold. Self-approval is refused.

## 5. The consequence post-when-approved creates

**An approved-later expense makes the day's cash look higher than it is.**

The money has physically left the bank, but the ledger has not recorded it
until approval. Between the two, `1000`/`1010` read higher than the drawer
holds. The daily closing will report that as a cash difference that is not a
counting error.

This is accepted, and spec 4 inherits a hard requirement: **the closing screen
must show expenses awaiting approval for the day alongside expected cash**, so
the operator can reconcile a pending LKR 200,000 machine purchase against a
drawer that is genuinely LKR 200,000 lighter. Without that line, every evening
closing after a large unapproved purchase looks like a till shortage.

`expenses_crossfoot` is unaffected: it compares *ledger* movement to *POSTED*
expenses, so a pending expense is on neither side and the check stays true.

## 6. Receipts

Uploaded to R2 as `expenses/{id}/{uuid}.{ext}`, jpeg/png/webp, 5 MB — the
pattern `routes/products.ts` and `routes/oldgold.ts` already use, followed
exactly. `expenses.receipt_key` holds the single key; unlike product images
there is no array, because an expense has one receipt.

A receipt can be attached to an expense in any state, including after
approval, so an operator is never blocked from filing evidence they already
have. But an expense above the receipt threshold **cannot be approved** until a
receipt is attached.

## 7. API

No new permissions. The count stays at 53.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/expense-categories` | `accounts:view` | each with its account and lifetime spend |
| POST | `/expense-categories` | `accounts:manage` | allocates the account code |
| PATCH | `/expense-categories/:id/status` | `accounts:manage` | refuses when the category has entries |
| GET | `/expenses` | `accounts:view` | `?from&to&branchId&categoryId&status&page&limit` |
| POST | `/expenses` | `accounts:manage` | posts immediately, or lands `PENDING_APPROVAL` |
| GET | `/expenses/:id` | `accounts:view` | with category, entry and approval trail |
| POST | `/expenses/:id/approve` | `accounts:manage` | `{reason?}`; approver ≠ requester |
| POST | `/expenses/:id/reject` | `accounts:manage` | `{reason}` required |
| POST | `/expenses/:id/receipt` | `accounts:manage` | multipart upload |
| GET | `/expenses/:id/receipt` | `accounts:view` | streams the receipt |
| GET | `/expenses/reports/summary` | `accounts:view` | by category for a period |

`/expenses/reports/summary` is registered **before** `/expenses/:id`, the same
ordering trap `accounts.ts` hit: Hono matches in registration order, so a
literal path reached after `/:id` would be read as an expense id.

## 8. Reconciliation

One new check, bringing the total to 18.

**`expenses_crossfoot`** — movement on the payment accounts for entries with
`ref_entity = 'expense'` equals the sum of `POSTED` expenses for the day. Like
`payments_crossfoot` it is scoped by `ref_entity`, so it picks up this spec's
entries without disturbing anything else, and it is **not** branch-filtered:
the check is about the payment account, and the cost side is checked by
`trial_balance`.

## 9. Data flow example

A LKR 45,000 repair on 2026-09-28 at the Colombo branch, paid from the
Commercial Current account, approved by someone other than the requester:

- Above both thresholds, so a receipt is required and approval is required.
- Created `PENDING_APPROVAL`, no journal entry, `payment_account_code = '1010'`.
- Receipt attached at `expenses/{id}/{uuid}.jpg`.
- Approved → `DR 6030 Repairs & Maintenance 4,500,000 / CR 1010 4,500,000`,
  `status = POSTED`, `journal_entry_id` set.
- `expenses_crossfoot` sees 4,500,000 credited out of 1010 and 4,500,000 of
  posted expenses. Balanced.
- Had it been left pending overnight, the Colombo branch's expected cash at
  close would read 4,500,000 too high — which is exactly what spec 4's
  "awaiting approval" line exists to explain.

## 10. Testing

**Vitest** — the pure arithmetic goes to `packages/shared/src/accounting.ts`:
`expensePosting(amountCents, thresholds)` returning
`{ requiresReceipt, requiresApproval }`, and `pendingApprovalTotal(posted,
pending)` for the line spec 4 will render. Both are pure and directly tested.

**Live gate:**

1. `GET /expense-categories` lists the nine seeded categories with their
   accounts.
2. Create a category; confirm it took `6090` and created the ledger account.
   Try to deactivate a category with entries; expect `CONFLICT`.
3. Record a LKR 500 expense paid in cash. Confirm it posts immediately:
   `DR 6010 / CR 1000`, `status = POSTED`.
4. Record a LKR 45,000 expense above both thresholds. Confirm it lands
   `PENDING_APPROVAL` with no entry, and that approving it without a receipt
   returns `400`.
5. Attach a receipt, approve it as a different user, and confirm the entry
   posts and `expenses_crossfoot` passes.
6. Try to approve your own expense; expect `FORBIDDEN`.
7. Reject an expense with a reason; confirm it stays visible as `REJECTED`
   with no entry.
8. Pay an expense from the **second** bank account and confirm
   `payments_crossfoot` still passes.
9. Run a full day and confirm all 18 checks pass.

## 11. Out of scope

Recurring expenses and a due list; petty cash and float reconciliation;
multi-currency; expense reports beyond the by-category summary; a budget or
variance against one; the daily-closing screen and its "awaiting approval"
line (spec 4); and OCR or any automatic receipt reading.

## 12. Self-review

- No TBD/TODO. Every account, posting pair, threshold, endpoint, permission and
  check is stated.
- Consistent: one document row plus one entry in one batch, or no entry until
  approval; no new permissions; the same envelope, `serviceError` and
  `{rows, total}` conventions; R2 upload copied from the existing pattern
  rather than reinvented.
- The two things most likely to be got wrong are pinned explicitly: the
  expense is attributed to the branch that *incurred* it, not the branch whose
  cash paid it; and an unapproved expense makes cash read high, which spec 4
  must surface rather than hide.
- Unambiguous: both threshold keys and defaults, the 6090-6199 allocation
  range, the approver-≠-requester rule, the receipt gate on approval, and why
  `expenses_crossfoot` is not branch-filtered.
