# GoldOS — Cash & Bank Design

Date: 2026-09-28
Status: Approved
Scope: Bank accounts, cash deposits and withdrawals, branch-to-branch cash
transfers, card settlement out of Card Clearing, bank statement reconciliation,
and the two cross-foot checks that cover them. Also closes the gold-ledger gap
that a branch stock transfer leaves behind. No expenses (spec 3), no daily
closing or cash counting (spec 4).

## 1. Context

The ledger posts card sales to **1020 Card Clearing** and never moves them, so
the amount owed by the acquirer is visible but nothing ever settles it. Cash
(1000) and Bank (1010) are single accounts with no owner, no count and no
reconciliation. A supplier payment picks `1000` or `1010` by a free-text
method, so a shop with two banks cannot tell them apart.

Two structural gaps came out of the ledger-core work:

- `purchases_crossfoot` and `payments_crossfoot` both assume bank money lives
  at `1010`. Once bank accounts are configurable those checks need to read the
  account codes rather than hard-code one.
- A product transfer updates `products.branch_id` and writes `stock_movements`
  rows, but writes **no `gold_ledger` row**. The ledger therefore loses track
  of gold as it moves between branches, and the per-branch gold checks — which
  now pass — will break the first time the shop moves stock.

Approach: every flow is a document row plus one or two journal entries, all in
one atomic batch, following the pattern spec 1 established. Cash needs no table
of its own; one 1000 per branch is already what the ledger models.

Decisions (user-confirmed):
- One cash account per branch. No till sessions, no float, no cashier cash
  liability — spec 4 counts the drawer at day close instead.
- Bank accounts are configurable, each with its own ledger account code.
- Card settlement is manual, with an optional fee booked to 6060.
- Transfers cover cash↔bank *and* branch↔branch. The two are separate flows
  because they are different kinds of movement.
- Bank reconciliation is a recorded statement balance plus an uncleared list.
  No statement import, no auto-matching.
- A product transfer must write a `gold_ledger` row.

## 2. Schema (migration `0018_cash_bank`)

```sql
CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  account_code TEXT NOT NULL UNIQUE REFERENCES chart_of_accounts(code),
  branch_id TEXT REFERENCES branches(id),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  opened_on TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE card_settlements (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  settled_on TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL,
  acquirer_ref TEXT,
  note TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE cash_transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  from_branch_id TEXT NOT NULL REFERENCES branches(id),
  to_branch_id TEXT NOT NULL REFERENCES branches(id),
  amount_cents INTEGER NOT NULL,
  sent_on TEXT NOT NULL,
  received_on TEXT,
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT',
  reason TEXT NOT NULL,
  from_entry_id TEXT REFERENCES journal_entries(id),
  to_entry_id   TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE bank_reconciliations (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  statement_date TEXT NOT NULL,
  statement_balance_cents INTEGER NOT NULL,
  ledger_balance_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_cs_account ON card_settlements(bank_account_id, settled_on);
CREATE INDEX idx_ct_status   ON cash_transfers(status, sent_on);
CREATE INDEX idx_br_account  ON bank_reconciliations(bank_account_id, statement_date DESC);

INSERT INTO counters (name, next) VALUES ('SETL', 1), ('XFER', 1);
```

`cash_transfers.status` is `IN_TRANSIT` or `COMPLETE`. A transfer is never
cancelled: a transfer that turns out to be wrong is a second, opposite
transfer, per the append-only rule.

## 3. Bank account codes

The shop does not think in account codes, so the endpoint allocates one:

- The **first** bank account adopts the existing `1010 Bank` system account.
  Registering it does not edit the account, so the system-account guard is not
  in the way.
- Each additional account takes the **lowest unused code in 1011-1099**, minus
  1020 (Card Clearing). It is created with `is_system = 0` and a name the
  operator supplies, so it behaves like any other configurable account.
- If no code is free in that range the request fails with `VALIDATION` rather
  than inventing a code outside the asset block.

`POST /bank-accounts` creates the ledger account and the registration in one
batch, so the two can never disagree.

## 4. Flows

| Flow | Posting |
|---|---|
| Bank opening balance | `DR <code> / CR 3100` |
| Cash deposit | `DR <code> / CR 1000` |
| Cash withdrawal | `DR 1000 / CR <code>` |
| Branch transfer — sent | `CR 1000` at the **from** branch / `DR 1030` |
| Branch transfer — received | `DR 1000` at the **to** branch / `CR 1030` |
| Card settlement | `DR <code> (net) / CR 1020 (gross) / CR 6060 (fee)` |
| Supplier payment | already `CR 1000 or 1010`; becomes `CR <bank account code>` |

`gross_cents = net_cents + fee_cents`, enforced on input. The acquirer's
withholding lands in **6060 Bank & Card Charges** where it is visible, rather
than being absorbed. Whatever remains in 1020 at close is what the acquirer
still owes — that is the whole point of clearing through 1020 rather than
booking card sales straight to bank.

### Why a transfer is two entries

A journal entry has exactly one `branch_id`. A single cross-branch entry would
force the entry to be attributed to one branch, and the other branch's
reconciliation would be wrong by the full amount. So dispatch writes one entry
at the from-branch and receipt writes another at the to-branch, linked by
`cash_transfers`. Between the two, the money is explicitly `IN_TRANSIT` rather
than silently missing from both branches.

Dispatch and receipt are separate endpoints, because in reality they happen at
different times in different places.

A transfer is a movement *within* the shop, so no total changes — but
double-entry still has to balance and the money really is in transit between
the two branches until it arrives. **1030 Cash in Transit** is that resting
place, an asset the shop owns. Its balance is exactly what
`cash_in_transit` asserts against the transfers table, so the check needs no
sign gymnastics: a dispatch debits 1030 and a receipt credits it.

### Opening balances

A bank account's opening balance is a real entry (`CR 3100`), the same
treatment spec 1 gave party and cash opening balances. `opening_balance_cents`
on `bank_accounts` records what was opened with, for display; the ledger is the
authority. `opened_on` guards against a second opening.

## 5. Gold ledger and product transfers

`recordMovement` in `services/inventory.ts` gains a `gold_ledger` row when a
product moves branch: source `branch:<from>`, destination `branch:<to>`, type
`TRANSFER`, carrying the product's fine gold and purity. This is the same
direction convention spec 1 established and that `gold_stock_consistency` reads.

Without it, `heldGoldMg` for the destination branch counts a product whose
ledger row is attributed to the origin branch, and the check fails by exactly
the transferred weight.

The two `stock_movements` rows the transfer already writes are unchanged.

## 6. API

All under existing permissions — no new permissions, count stays 53.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/bank-accounts` | `accounts:view` | each with its ledger balance |
| POST | `/bank-accounts` | `accounts:manage` | allocates the account code, creates both rows |
| PATCH | `/bank-accounts/:id` | `accounts:manage` | rename, deactivate; refuses once it has entries |
| POST | `/bank-accounts/:id/opening` | `accounts:manage` | `{amountCents, entryDate?, reason}` |
| POST | `/cash/deposits` | `accounts:manage` | `{branchId, bankAccountId, amountCents, entryDate?, note?}` |
| POST | `/cash/withdrawals` | `accounts:manage` | same shape |
| POST | `/cash/transfers` | `accounts:manage` | `{fromBranchId, toBranchId, amountCents, sentOn?, reason}` → dispatch |
| POST | `/cash/transfers/:id/receive` | `accounts:manage` | `{receivedOn?}` |
| GET | `/cash/transfers` | `accounts:view` | filter by status, from/to branch |
| POST | `/card-settlements` | `accounts:manage` | `{bankAccountId, grossCents, feeCents?, settledOn?, acquirerRef?, note?}` |
| GET | `/card-settlements` | `accounts:view` | with 1020 cleared per settlement |
| POST | `/bank-accounts/:id/reconcile` | `accounts:view` | records `{statementDate, statementBalanceCents, note?}`, returns ledger balance, difference and the uncleared list |

The reconcile endpoint is a write under a read permission because recording
what the statement said is part of proving the account; the *adjustment* that
fixes a difference is a manual adjustment under `accounts:manage`, which is the
existing rule for corrections.

## 7. New reconciliation checks

Two more, bringing the total to 17.

**`card_clearing`** — 1020's movement for the day equals the sum of that day's
settlement gross amounts. Scoped by `ref_entity = 'card_settlement'`, so it
picks up the settlements this spec adds without disturbing
`payments_crossfoot`.

**`cash_in_transit`** — dispatched minus received, in cents, must equal the
sum of `cash_transfers` rows still `IN_TRANSIT`. This is what stops money
disappearing between the two branches of a transfer.

### Existing checks that must be updated

`payments_crossfoot` hard-coded `account_code IN ('1000','1010','1020')`. With
configurable bank accounts that becomes:

```sql
l.account_code IN ('1000','1020')
OR l.account_code IN (SELECT account_code FROM bank_accounts)
```

Otherwise a payment out of a second bank would be invisible to the check and
every paid purchase from that bank would show as a discrepancy.

## 8. Data flow example

A card settlement of gross 250,000 with a 6,000 fee into the second bank:

- `net_cents = 250,000 − 6,000 = 244,000`
- Entry: `DR <code2> 244,000 / CR 1020 250,000 / CR 6060 6,000`
- 1020 falls by the full gross, 6060 records the acquirer's cut, and the bank
  receives only what actually arrived.

A 100,000 branch transfer from Colombo to Kandy:

- Dispatch: entry `CR 1000 @colombo`, `cash_transfers.status = IN_TRANSIT`
- Receipt: entry `DR 1000 @kandy`, `status = COMPLETE`
- Between the two, `cash_in_transit` shows 100,000 outstanding, and each
  branch's own 1000 balance is correct for the cash it actually holds.

## 9. Testing

**Vitest** — the pure arithmetic moves to `packages/shared/src/accounting.ts`
and is unit-tested: `settlementAmounts(gross, fee)` returning net and the
validated pair, `transferStatus(sent, received)`, and `inTransitTotal(dispatched,
received)`.

**Live gate:**

1. Register a second bank account; confirm it got the lowest free 10xx code
   and that `GET /bank-accounts` shows both.
2. Open it with 500,000; confirm the entry is `DR <code> / CR 3100` and that
   3100 nets against it.
3. Deposit 200,000 cash to it; confirm 1000 falls and the bank account rises.
4. Settle a card batch of 250,000 gross with a 6,000 fee; confirm 1020 falls by
   the gross, 6060 by the fee, and the bank by the net.
5. Dispatch a branch transfer, run reconciliation, and see `cash_in_transit`
   report it outstanding. Receive it; see it clear and both branches correct.
6. Pay a supplier from the second bank account; confirm `payments_crossfoot`
   still passes.
7. Transfer a product between branches; confirm the gold ledger gains a
   TRANSFER row and `gold_stock_consistency` still passes for both branches.
8. Record a bank statement balance; confirm the difference and uncleared list.

## 10. Out of scope

Cash counting, variance and explanation; the day-close screen and lock;
expenses and receipts; cheque and cash-book registers; foreign currency and FX
revaluation; bank statement import or auto-matching; cash sessions and floats;
and multi-currency settlement.

## 11. Self-review

- No TBD/TODO. Every account, posting pair, endpoint, permission and check is
  stated.
- Consistent: every flow is a document row plus journal entries in one batch
  with its audit row, exactly as spec 1 established; no new permissions; the
  same `serviceError` envelope.
- The two branches a reader most often get wrong are pinned: a transfer is two
  entries because an entry has one `branch_id`, and a card settlement splits
  gross into net plus fee so the acquirer's cut is booked rather than lost.
- Unambiguous: the account-code allocation rule, the guard on re-opening an
  account, the `ref_entity` used by the new check, and the rewrite of
  `payments_crossfoot`'s account filter.
