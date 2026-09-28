# GoldOS — Daily Closing Design

Date: 2026-09-28
Status: Approved
Scope: A closing screen per branch and day — the money and gold summary,
opening/cash-in/cash-out/expected/actual/difference, the difference
explanation, the lock on a closed day, re-opening by a second person, the
frozen snapshot, and the daily closing report. No forecasting, no multi-day
periods, and no month or year-end close.

## 1. Context

The ledger now reconciles: 18 cross-foot checks pass for a real trading day,
and every transaction posts itself. What is missing is the thing the shop
actually does at the end of a day — count the drawer, compare it to what the
books say should be there, and explain any difference. Today the shop
"calculates the day's accounts" by hand, which is exactly what this removes.

Three things this spec inherits and must honour:

- Money reconciles in cents and gold in fine milligrams. No line mixes them.
- The `expenses_crossfoot` check is not branch-filtered (a head-office cost
  paid from the main bank belongs to one branch while the money left another).
  The closing screen is **per branch**, so it filters by branch where that is
  sound and says so where it is not.
- **An unapproved expense has left the bank but is not in the ledger**, so the
  ledger's cash reads high by exactly that amount. The screen must show
  *expenses awaiting approval* beside expected cash, or a pending LKR 75,000
  wage run will look like a till shortage.

Decisions (user-confirmed):
- Opening cash is **read from the ledger** — the `1000` balance before the day
  began — so the screen reconciles against the ledger rather than against
  itself, and a wrong opening is caught rather than propagated. It also works
  on the first day and after a missed close, which a carried-forward figure
  would not.
- A day closes **per branch**. Cash is a physical thing in a specific place;
  a combined figure is not something anyone can count.
- Re-opening a closed day needs a **written reason and a second person**, the
  same approver-≠-requester rule expenses use.

## 2. Schema (migration `0020_day_closing`)

```sql
CREATE TABLE day_closings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  close_date TEXT NOT NULL,
  opening_cents INTEGER NOT NULL,
  cash_in_cents INTEGER NOT NULL,
  cash_out_cents INTEGER NOT NULL,
  expected_cents INTEGER NOT NULL,
  actual_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  difference_reason TEXT,
  report_json TEXT NOT NULL,
  checks_passed INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CLOSED',
  closed_by TEXT REFERENCES users(id),
  closed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_dc_branch_date ON day_closings(branch_id, close_date);
CREATE INDEX idx_dc_date ON day_closings(close_date);

CREATE TABLE day_reopens (
  id TEXT PRIMARY KEY,
  closing_id TEXT NOT NULL REFERENCES day_closings(id),
  reason TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_dr_closing ON day_reopens(closing_id);
```

`day_reopens` is separate and append-only, so a day reopened twice has two
records rather than one overwritten reason. `report_json` freezes the screen as
it stood at close, so the report can be re-read later even after the code
around it changes.

## 3. The lock

A closed day must reject new postings. Rather than add a check to all six
posting services, the guard goes in **`buildEntryStmts`** — the single choke
point every journal entry already passes through, and which already receives
both `entryDate` and `branchId`:

```ts
if (post.branchId) {
  const locked = await db
    .prepare(
      "SELECT 1 AS x FROM day_closings WHERE branch_id = ? AND close_date = ? AND status = 'CLOSED'"
    )
    .bind(post.branchId, entryDate)
    .first();
  if (locked)
    throw Object.assign(
      new Error(`The day ${entryDate} is closed at this branch`),
      { code: "TRANSITION_LOCKED" }
    );
}
```

One indexed lookup, and **every** flow is covered — sales, purchases,
expenses, card settlement, bank transfers, gold adjustments — because none of
them can reach the ledger without it. Without this, "lock normal edits" would
mean six separate checks that one of them eventually forgets.

Backdating into a closed day is refused by the same guard, which is the
restriction spec 1 left open when it decided `entry_date` may be overridden.

The check sits in `services/journal.ts` and reads a table from migration
0020, so **spec 4 cannot start until 0015-0019 are applied** — it already
requires the whole ledger.

## 4. The closing report

All money in cents, all gold in fine milligrams.

### Money

| Line | Source |
|---|---|
| Sales | net credit on 4000 for the day, branch-filtered |
| Purchases | non-void, non-reversed purchase invoice totals for the day |
| Old Gold Purchases | `old_gold_purchases.value_cents` for the day |
| Expenses | `POSTED` expenses for the day, branch-filtered |
| **Expenses awaiting approval** | `PENDING_APPROVAL` for the day, branch-filtered |
| Cash In | Σ **debits** to 1000, broken down below |
| Cash Out | Σ **credits** to 1000, broken down below |
| Bank Transactions | Σ movement on every bank account code plus 1020, branch-filtered on the account's branch |
| Customer Payments | `sales_payments` (non-credit) less `sales_returns.refund_cents` |
| Supplier Payments | `purchase_payments` plus `old_gold_purchases.paid_cents` |

### Cash In / Cash Out breakdown

Every debit to `1000` is Cash In; every credit is Cash Out. Classified by the
entry's `ref_entity`:

| Direction | `ref_entity` | Line |
|---|---|---|
| In | `sale_invoice` | Sales |
| In | `cash_withdrawal` | Bank withdrawals |
| In | `cash_transfer_in` | Transfers in |
| Out | `purchase_payment` | Supplier payments |
| Out | `expense` | Expenses |
| Out | `cash_deposit` | Deposits |
| Out | `sale_return` | Refunds |
| Out | `cash_transfer_out` | Transfers out |

### Gold

| Line | `gold_ledger.type` |
|---|---|
| Gold Purchased | `PURCHASE`, `OLD_GOLD_PURCHASE` |
| Gold Sold | `SALE` |
| Gold Melted | `MELTING_INPUT` in, `MELTING_OUTPUT` out |
| Gold Used | `MANUFACTURING_INPUT` |
| Gold Adjustments | `ADJUSTMENT`, `LOSS`, `RECOVERY` |

### The arithmetic

```
Opening Cash        = Σ(1000 movement) where entry_date < close_date, this branch
Cash In             = Σ(debits to 1000) for the day
Cash Out            = Σ(credits to 1000) for the day
Expected Closing    = Opening + Cash In − Cash Out
Actual Closing      = what the shop counted
Cash Difference     = Actual − Expected
```

### The property that makes it trustworthy

**The named Cash In / Cash Out lines must sum to the raw ledger movement.**
If a new flow ever posts to cash in a way this screen does not recognise, the
remainder appears on an **Unclassified** line and **blocks the close**.

That guard is the whole reason the breakdown can be believed. Without it the
screen would quietly report a wrong number whenever someone added a new cash
flow, and the shop would reconcile against it — which is precisely the manual
work this spec exists to remove.

## 5. Closing a day

A day may be closed only when **all 18 reconciliation checks pass** for that
branch and date. The close records which checks it saw, so a later reader can
tell what the shop knew at the time.

- `difference_cents ≠ 0` **requires** `differenceReason`. A nil difference
  must not carry a reason.
- The close stores the whole rendered report in `report_json`, so the
  daily closing report is a faithful record rather than a re-derivation that
  could drift.
- Closing the same branch and date twice is `CONFLICT`.

## 6. Re-opening

A closed day is not permanent, but it is not casual either:

1. `POST /day-closings/:id/reopen` with `{reason, approvedBy}`.
2. The requester must hold `accounts:manage`, and the approver must too, and
   **must not be the requester**.
3. The approver must not be the person who closed the day.
4. On approval the closing's `status` becomes `REOPENED` — which stops the
   lock, because the lock only fires on `CLOSED`.

The original close row is **kept** with its snapshot, actual count and
difference, and a `day_reopens` row records who asked, who approved and why.
Re-opening twice leaves two rows.

A re-opened day that is closed again writes a new `day_closings` row; the
unique index is on `(branch_id, close_date)` with status, so the re-close
updates the row and the full history lives in `day_reopens` plus
`audit_logs`.

## 7. API

No new permissions. The count stays at 53.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/day-closings` | `accounts:view` | `?branchId&from&to&page&limit` |
| GET | `/day-closings/preview` | `accounts:view` | `?branchId&date` → the rendered report, plus each check's pass state |
| GET | `/day-closings/:id` | `accounts:view` | the frozen `report_json` plus the reopen trail |
| POST | `/day-closings` | `accounts:manage` | `{branchId, date, actualCents, differenceReason?}`; 409 on a non-zero difference with no reason, 409 on a failed check, 409 if already closed |
| POST | `/day-closings/:id/reopen` | `accounts:manage` | `{reason, approvedBy}` |
| GET | `/day-closings/:id/report` | `accounts:view` | the frozen report, for printing or export |

`/day-closings/preview` is registered **before** `/day-closings/:id` — Hono
matches in registration order, the same trap `accounts.ts` and `expenses.ts`
already hit.

`preview` is a read, so the screen can be rendered and the count typed
without holding `accounts:manage`. Only the final close needs it.

## 8. Testing

**Vitest** — the arithmetic is pure and goes to
`packages/shared/src/accounting.ts`:

- `closingArithmetic(openingCents, cashInCents, cashOutCents)` returning
  `{ expectedCents }`
- `closingDifference(expectedCents, actualCents, reason?)` returning
  `{ differenceCents, reasonRequired, valid }` — a non-zero difference with no
  reason is `valid: false`
- `cashBreakdownTotal(lines)` returning `{ total, unclassified }` — the guard
  that makes the breakdown believable

**Live gate:**

1. Preview a branch-day with no activity. Every money and gold line is zero,
   unclassified is zero, and the difference is nil.
2. Run a trading day, preview it, and confirm the named cash lines sum exactly
   to the raw movement on 1000.
3. Enter an actual count that matches. Close. Confirm a `day_closings` row and
   a frozen report.
4. Try to post a sale dated the closed day. Expect `409 TRANSITION_LOCKED`.
5. Try to backdate an entry into the closed day. Expect the same.
6. Re-open with the same user as approver. Expect `403`. Re-open with a
   different one and a reason; confirm the trail row and that posting works
   again.
7. Close a day with a failed check. Expect `409` naming the check.
8. Close with a non-zero difference and no reason. Expect `400`. With a
   reason, expect success.
9. Add a deliberate unclassified cash movement and confirm the close is
   blocked rather than reporting a wrong number.

## 9. Out of scope

Month, quarter and year-end closing; a comparative P&L across days; cash
forecasting; a till float and petty cash; multi-currency closing; export to
spreadsheet; and a printable document beyond the frozen JSON report.

## 10. Self-review

- No TBD/TODO. Every table, posting, line, endpoint, permission and check is
  stated.
- Consistent: the lock lives in the one place every posting already passes
  through, rather than in six services that will eventually disagree; no new
  permissions; the same envelope, `serviceError` and `{rows, total}`
  conventions; the same approver-≠-requester rule expenses already uses.
- Three things a reader would otherwise get wrong are pinned explicitly:
  opening cash comes from the ledger rather than yesterday's count; the
  unclassified guard is what makes the breakdown trustworthy; and the
  awaiting-approval line is not optional, because without it a pending wage
  run reads as a till shortage.
- Unambiguous: the `ref_entity` table behind every cash line, the
  `TRANSITION_LOCKED` code, the check gate, the reason requirement, and the
  rule that only `CLOSED` blocks a posting.
