# GoldOS — Ledger Core Design

Date: 2026-09-28
Status: Approved
Scope: Restructure the journal into header + lines with a first-class
transaction date, expand and make the chart of accounts configurable, adopt
append-only reversal, convert opening balances into real entries, carry gold
inventory at book cost via lot costing, post melting/manufacturing/adjustment
money, and add eight reconciliation checks. No cash sessions, card settlement,
bank reconciliation, expenses, daily closing, day lock, or report UI — those
are specs 2, 3, and 4.

## 1. Context

Money already has a ledger: `chart_of_accounts` (11 accounts), a flat
`journal_entries` table, `postJournalStmts` with balance validation, and six
posting call sites (sales, sale returns, purchase receive, purchase payment,
purchase void, old-gold purchase). Four structural gaps block the goal that the
shop never calculates its own accounts.

1. A posting is only *implicitly* grouped. Lines are tied together by
   `(ref_entity, ref_id)` but there is no entry to fetch, reverse, or snapshot
   as a unit — the shape a journal entry is supposed to have.
2. There is no transaction date. Reports filter on `created_at`, the instant
   the row was keyed in. A supplier invoice that lands the next morning, or a
   card settlement batch, has nowhere to go. Day closing needs a date.
3. Corrections are unlinked mirrors. `voidInvoice` posts a fresh `DR 2000 /
   CR 1100` with no pointer to the original, so the ledger cannot distinguish a
   mistake from a second event, and a closed day cannot be protected.
4. Melting and manufacturing post **no money at all** — only gold weights.
   Account 6000 is seeded and never used. There is no expenses module, no
   card clearing, and no cash or bank opening balance.

A fifth issue is financial rather than structural. `finishOrder`
(manufacturing.ts:279-290) costs a finished piece at
`fine_gold_mg × rate_cents_per_g` — the day's board rate — plus labour. That is
market value, not cost. A shop buying at 8,000/g with the rate at 9,000/g
carries inventory 1,000/g too high and reports margin that is not margin.

Approach: header+line journal with an explicit business date, append-only
reversal, and book-cost lot tracing (A). Alternatives rejected per user
choice: adding `entry_id` to the flat table, which leaves no header row to
hold memo/status and still cannot reverse a unit (B); and a single flat
rebuild from source documents, which loses hand-made adjustments (C).

Decisions (user-confirmed):
- Four phased specs, dependency-ordered. This is spec 1 of 4.
- Journal = header table + lines table, backfilled from existing rows.
- `entry_date` is a separate business date; backdating allowed, restricted
  once a day is closed (the lock itself lands in spec 4).
- Append-only: correct with a linked mirror entry, never edit or delete.
- Purchases debit Gold Inventory directly. No separate purchases account.
- Each expense category owns a ledger account. Accounts are configurable.
- Card sales clear through 1020 and settle to Bank separately.
- All opening balances become real journal entries; the
  `opening_balance_cents` columns are retired.
- Manufacturing costs are capitalised into inventory; melting loss is valued.
- Gold inventory is carried at **book cost**; gold reconciles in **weight**.
- Spec 1 ships API and tests only. No new web screens.
- Reconciliation is built-in cross-foot checks that spec 4 gates day close on.

## 2. Schema (migration 0015_ledger_core)

### 2.1 Journal restructure

```sql
ALTER TABLE journal_entries RENAME TO journal_lines;
ALTER TABLE journal_lines ADD COLUMN entry_id TEXT;
ALTER TABLE journal_lines ADD COLUMN line_no INTEGER;
```

`journal_lines` keeps `id, entry_id, line_no, account_code, debit_cents,
credit_cents, party_type, party_id, memo`. Dropped from the line (now on the
header): `ref_entity, ref_id, branch_id, created_at`. `created_by` moves to
the header; the line's author is always the entry's author.

```sql
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  memo TEXT,
  ref_entity TEXT,
  ref_id TEXT,
  ref_no TEXT,
  source_module TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'POSTED',
  reverses_entry_id TEXT REFERENCES journal_entries(id),
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_je_date   ON journal_entries(entry_date, branch_id);
CREATE INDEX idx_je_ref    ON journal_entries(ref_entity, ref_id);
CREATE INDEX idx_je_module ON journal_entries(source_module, entry_date);
CREATE INDEX idx_je_status ON journal_entries(status);
CREATE INDEX idx_je_reverses ON journal_entries(reverses_entry_id);
INSERT INTO counters (name, next) VALUES ('JE', 1);

CREATE INDEX idx_jl_entry   ON journal_lines(entry_id, line_no);
CREATE INDEX idx_jl_account ON journal_lines(account_code);
CREATE INDEX idx_jl_party   ON journal_lines(party_type, party_id);
```

- `entry_date` — `'YYYY-MM-DD'`, shop-local. `status` is `POSTED` or
  `REVERSED`; there is no `DRAFT`, because every entry is posted inside the
  same atomic batch as its source document.
- `ref_entity` values: `sale_invoice, sale_return, purchase_invoice,
  purchase_payment, old_gold_purchase, expense, bank_txn, card_settlement,
  opening_balance, adjustment, mfg_order, melt_batch, gold_adjustment,
  reversal`.
- `source_module` values: `sales, purchases, oldgold, expenses, bank, cash,
  closing, manual, manufacturing, melting, gold`.
- `reverses_entry_id` is set only on a reversal entry.
- `counters` gains `('JE', 1)`; entry numbers are `JE-000001`, zero-padded to
  six digits, allocated in the caller's batch.

### 2.2 Business date

`entry_date` is TEXT, not epoch millis. Cloudflare Workers run UTC and the
shop is in Sri Lanka (UTC+5:30), so the existing `dayBounds()` helpers already
compute "today" wrongly for this shop. A `YYYY-MM-DD` string compares
correctly under `BETWEEN`, sorts correctly, and is self-documenting in a
report. The offset lives in data, not code, per the "config not code" rule in
`docs/business-rules.md`:

- `settings` key `business_tz_offset_minutes`, default `330`.
- `businessDate(epochMs, offsetMinutes)` in `packages/shared` returns the
  shop-local `YYYY-MM-DD`. `entry_date` defaults to it and is overridable by
  the caller.
- Existing `dayBounds()` helpers in the sales/purchases/oldgold/manufacturing
  routes are switched to the same helper so reports and the ledger agree.

### 2.3 Chart of accounts

```sql
ALTER TABLE chart_of_accounts ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chart_of_accounts ADD COLUMN description TEXT;
INSERT INTO counters (name, next) VALUES ('JE', 1);
```

The chart stays **flat** — no `parent_code`, no group accounts. Rollups are
by `type`. Hierarchy is speculative; nothing needs it.

| Code | Name | Type | Status |
|---|---|---|---|
| 1000 | Cash on Hand | ASSET | existing |
| 1010 | Bank | ASSET | existing |
| 1020 | Card Clearing | ASSET | new — card sales land here, settle to 1010 |
| 1100 | Gold Inventory | ASSET | existing |
| 1200 | Customer Receivables | ASSET | existing |
| 2000 | Supplier Payables | LIABILITY | existing |
| 2100 | Tax Payable | LIABILITY | existing |
| 2200 | Other Payables | LIABILITY | new — accrued manufacturing cost |
| 3000 | Owner's Equity | EQUITY | existing |
| 3100 | Opening Balances | EQUITY | existing |
| 4000 | Sales Revenue | REVENUE | existing |
| 5000 | Cost of Goods Sold | EXPENSE | existing |
| 5100 | Gold Melting Loss | EXPENSE | new |
| 5200 | Gold Manufacturing Loss | EXPENSE | new |
| 5300 | Gold Adjustment Loss | EXPENSE | new |
| 6000 | Rent & Rates | EXPENSE | renamed (zero entries today) |
| 6010 | Utilities | EXPENSE | new |
| 6020 | Salaries & Wages | EXPENSE | new |
| 6030 | Repairs & Maintenance | EXPENSE | new |
| 6040 | Transport & Delivery | EXPENSE | new |
| 6050 | Marketing & Advertising | EXPENSE | new |
| 6060 | Bank & Card Charges | EXPENSE | new |
| 6070 | Office & Consumables | EXPENSE | new |
| 6080 | Other Expenses | EXPENSE | new |

24 accounts. There is deliberately **no** "Old Gold Sales Revenue" account:
`convertToProduct` (oldgold.ts:380) already carries
`old_gold_items.purchase_value_cents` as the product's `cost_cents` and posts
no journal, because it is a reclassification *within* 1100. Revenue is
recognised once, on the normal sale path through 4000.

The nine expense accounts (6000-6080) are the accounts spec 3's expense
categories will point at. 6000 is renamed rather than left as a generic
"Operating Expenses" bucket because it has no entries, and a catch-all defeats
the decision that every category owns an account.

### 2.4 Lot costing

```sql
ALTER TABLE melting_batches  ADD COLUMN input_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE melting_outputs  ADD COLUMN cost_cents      INTEGER NOT NULL DEFAULT 0;
INSERT INTO counters (name, next) VALUES ('GADJ', 1);
```

No new column on `manufacturing_materials`. Allocation cost is computed at
`finishOrder` from the lot, using the shared `allocateProportional` helper
(§6), so rounding never drifts across successive allocations. The two weights
passed to it sum to the lot's full `fine_mg`, which is what makes
`allocateProportional` return the allocated share rather than the whole lot.

### 2.5 Document → entry links

```sql
ALTER TABLE sales_invoices     ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE sales_returns      ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE purchase_invoices  ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE old_gold_purchases ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
```

`voidInvoice` must reverse the *specific* entry its invoice created, not an
entry it guesses at by `(ref_entity, ref_id)` and timestamp. Note that the
void's own posting already shares `ref_entity = 'purchase_invoice'` and
`ref_id = invoiceId` with the receive (purchases.ts:523) — the two are only
distinguishable by `created_at`. Storing the link removes the guesswork and
gives spec 4's audit trail a direct "which entries does this document own"
answer. `buildEntryStmts` returns the header id so the caller can write it in
the same batch.

### 2.6 Retired columns

`customers.opening_balance_cents` and `suppliers.opening_balance_cents` are
dropped after backfill (see 3.3). This ripples and must be done as one change:
`createPartySchema` loses `openingBalance` (schemas.ts:65);
`services/parties.ts` loses the column from its `SELECT` (line 24), its
`RawPartyRow`/`PartyRow` types, its `INSERT` (line 90), its bind list (line
101), and its `opening_balance` return field (line 124); and the
"Opening balance (LKR)" field is removed from the customers and suppliers
web forms (`customers/page.tsx:22` and its suppliers twin). New parties start
at zero balance, and any balance a new party needs is established by an
opening-balance entry (§3.3), not by a column.

`partyLedger` (journal.ts:99) loses its `opening_balance_cents` lookup and
derives the opening from the 3100 backfill entries instead.

## 3. Posting rules and flows

### 3.1 Journal service

`postJournalStmts` becomes `buildEntryStmts(db, post)`. Same role — return
statements, let the caller batch them — but it now emits a header row plus
one row per line. `postJournalPost` gains `entryDate`, `refNo`,
`sourceModule`. Validation extends:

- Σdebit === Σcredit, both > 0, at least two lines, no line with both sides
  positive, no negative amounts (existing `checkBalanced`, unchanged).
- `entry_date` matches `^\d{4}-\d{2}-\d{2}$`.
- Every referenced account exists and `is_active = 1`.
- If `reversesEntryId` is set, the target must exist, be `POSTED`, and the
  mirror must match it exactly.

`reverseEntry(db, entryId, {reason, entryDate?, actorId})` copies the
original's lines with debit and credit swapped, sets `reverses_entry_id`, and
sets the original to `status = 'REVERSED'`. Nothing is ever updated in place
or deleted.

**A correction is a reversal. A business document is a new entry.** So
`voidInvoice` (purchases.ts:525) becomes a `reverseEntry` of the receive
posting. `createReturn` (sales.ts:374) stays a new entry with
`ref_entity = 'sale_return'` — a return is a real document, not an error fix.

### 3.2 Posting table

| Flow | Lines | Change |
|---|---|---|
| Sale | DR 1000 cash · DR 1020 card · DR 1010 bank/other · DR 1200 credit *(customer)* · CR 4000 total · DR 5000 cost · CR 1100 cost | card 1010 → 1020 |
| Sale return | mirror; card refunds credit 1020 | card 1010 → 1020 |
| Purchase receive | DR 1100 / CR 2000 *(supplier)* | unchanged |
| Purchase payment | DR 2000 / CR 1000\|1010 | unchanged |
| Purchase void | `reverseEntry` of the receive posting | was an unlinked mirror |
| Old-gold purchase | DR 1100 value / CR 1000 paid + CR 1200 remainder *(customer)* | unchanged |
| Manual adjustment | as today, `source_module = 'manual'` | unchanged |
| Old-gold → product | none | already correct; reclassification within 1100 |

`PAY_ACCOUNT` in `sales.ts:68` changes `card: "1010"` to `card: "1020"`.
`purchase_payments.method` stays cash/bank only and is untouched.

### 3.3 Opening balances

For each party with a non-zero `opening_balance_cents`, one entry dated the day
before that party's first transaction:

- Customer owes the shop: `DR 1200 / CR 3100` (both tagged `party_type =
  'customer'`).
- Shop owes the supplier: `DR 3100 / CR 2000` (both tagged `party_type =
  'supplier'`).

`3100 Opening Balances` finally receives postings, which it never did. Cash
and bank opening balances are posted by spec 2's cash/bank opening flow; the
account and the posting helper exist here.

### 3.4 Melting loss

`melting_batches.input_cost_cents` = Σ `old_gold_items.purchase_value_cents`
over the batch's inputs — what the shop actually paid those customers. Set
when the batch is approved. This needs only one source because
`melting_inputs.old_gold_id` is `NOT NULL UNIQUE` (0013_goldledger.sql:43):
today only old-gold items can enter a melting batch, so there is no second
cost basis to reconcile. If catalogue products ever become meltable, this
formula must branch on a null `old_gold_id` at the same time.

On batch **APPROVE**:

```
lossValue = round(input_cost_cents × loss_mg / (output_fine_mg + loss_mg))
lotCost   = input_cost_cents − lossValue
```

Posts `DR 5100 Gold Melting Loss / CR 1100 Gold Inventory` when `lossValue >
0`, and writes `cost_cents` on the single output lot. One rounding, no
allocation drift. When `recovery_mg > 0` the loss is zero by construction
(`loss_mg = max(input_fine_mg − output_fine_mg − waste_mg, 0)`), so nothing
posts and the lot carries the full input cost.

### 3.5 Manufacturing cost

At `finishOrder`, for each lot, the book value of the fine gold consumed:

```
V_lot = allocateCharges(lot.cost_cents, [allocatedFine, lotFine − allocatedFine])[0]
V_in  = Σ V_lot
fineIn = Σ manufacturing_materials.fine_mg
goldValue_o = round(fine_mg_o / fineIn × V_in)     for each output o
extras = labour_cents + making_cents + stone_cost_cents
cost_cents_o = goldValue_o + extrasShare_o          (extras split by net_mg, as today)
```

This **replaces** the market-rate formula at manufacturing.ts:279. The gold
itself is a reclassification within 1100 (input lot → finished product) and
nets to zero. One entry posts both the capitalised cost and the loss:

```
DR 1100  extras        CR 2200  extras
DR 5200  mfgLossValue  CR 1100  mfgLossValue
```
where `mfgLossValue = max(V_in − Σ goldValue_o, 0)`.

Extras accrue to 2200 Other Payables by default, with an optional `paidFrom`
(`'cash'` | `'bank'`) on the finish call that credits 1000 or 1010 instead.
Accruing rather than assuming cash keeps the daily closing's cash figure
honest — inventing a cash movement that did not happen would put the expected
closing cash permanently out.

### 3.6 Gold adjustments

`recordGoldAdjustment` (gold.ts:423) gains money alongside the gold row. An
adjustment carries a weight but no money, so the value must be derived:
`valueCents = round(fine_mg / 1000 × rate_cents_per_g)` from
`currentGoldRatesCents` for the adjustment's purity. **If no effective rate
exists for that purity, the adjustment is rejected with `VALIDATION`** —
valuing shrinkage without a rate would be a guess, and a guessed loss is worse
than no loss.

```
LOSS                            → DR 5300 / CR 1100  (valueCents)
ADJUSTMENT  (surplus found)     → DR 1100 / CR 5300  (valueCents)
RECOVERY                        → DR 1100 / CR 5300  (valueCents)
```

5300 therefore always shows **net** gold variance rather than mixing
shrinkage and surplus. The adjustment gains a `GADJ` counter and a
`ref_no` (`GADJ-000001`) so the daily closing can list individual
adjustments.

### 3.7 Book-cost chain

The cost trace is complete and each link is already book cost:

```
old_gold_items.purchase_value_cents   (or purchase_invoice_items.cost_cents)
  → melting_outputs.cost_cents        (input cost − loss value)
    → manufacturing_outputs.cost_cents (lot value + capitalised extras)
      → products.cost_cents
        → sales_items.cost_cents      (snapshotted at sale)
          → DR 5000 / CR 1100
```

`addMaterials` (manufacturing.ts:123-129) already refuses to over-allocate a
lot, so lot availability stays intact.

### 3.8 Backfill

Existing `journal_lines` rows group into headers by
`(ref_entity, ref_id, created_at, branch_id)`. Each group gets an `entry_id`,
a sequential `entry_no`, `entry_date = businessDate(created_at)`, and a
`source_module` inferred from `ref_entity`; `line_no` is assigned by
`(account_code, debit_cents, credit_cents)` for determinism.

**Historical card sales stay on 1010.** Reclassifying them would require
matching journal lines to `sales_payments` by amount, which is fragile.
1020 opens at zero; if the shop wants history moved it posts a reclassifying
entry, which the reversal machinery already supports.

## 4. API

All new routes follow the existing envelope, `requireAuth`, `requirePerm`,
`serviceError`, and `{rows, total}` list conventions. No new permissions —
`accounts:view` and `accounts:manage` already exist, and reconciliation is
read-only under `accounts:view`.

```
GET   /api/v1/accounts                  accounts:view    → + is_system, description, entry_count, is_editable
POST  /api/v1/accounts                  accounts:manage  → create; code /^\d{4}$/, unique, non-system
PATCH /api/v1/accounts/:code            accounts:manage  → name/description only
PATCH /api/v1/accounts/:code/status     accounts:manage  → deactivate/reactivate
GET   /api/v1/accounts/journal          accounts:view    ?from&to&branchId&accountCode&sourceModule&refEntity&page&limit
GET   /api/v1/accounts/journal/:id      accounts:view    → header + ordered lines
GET   /api/v1/accounts/trial-balance    accounts:view    ?date&branchId
GET   /api/v1/accounts/:code/statement  accounts:view    ?from&to&branchId → running balance
POST  /api/v1/accounts/journal/reverse  accounts:manage  {entryId, reason, entryDate?}
GET   /api/v1/accounts/reconciliation   accounts:view    ?date&branchId
```

`/accounts/journal` is registered before `/accounts/:code` so the literal path
wins. An account with any journal line can never be deactivated, renamed, or
retyped — `CONFLICT` carrying the entry count. `is_system = 1` rows reject
edits entirely. That is what makes "other configurable accounts" safe.

Existing `GET /api/v1/accounts` keeps its current response keys and adds
fields, so the accounts page keeps working unchanged.

Party ledgers keep their routes and now read from journal lines with no magic
column. The response matches the shop's own ledger vocabulary:

```
GET /api/v1/customers/:id/ledger → {opening, debitSales, creditPayments,
                                    creditReturns, closing, lines[]}
GET /api/v1/suppliers/:id/ledger → {opening, creditPurchases, debitPayments,
                                    debitReturns, closing, lines[]}
```

Customer closing = `opening + debitSales − creditPayments − creditReturns`.
Supplier closing = `opening + creditPurchases − debitPayments −
debitReturns`. Both must equal the party's share of 1200 / 2000, which is
check 6.

## 5. Reconciliation

`GET /api/v1/accounts/reconciliation?date&branchId` →

```json
{ "date": "2026-09-28", "passed": true,
  "checks": [{ "id": "trial_balance", "label": "…", "scope": "day|cumulative",
               "expected": 0, "actual": 0, "difference": 0,
               "pass": true, "detail": [] }] }
```

| # | id | What it proves |
|---|---|---|
| 1 | `entry_balance` | Every entry individually balances — catches a corrupt backfill |
| 2 | `trial_balance` | Cumulative Σdebit − Σcredit = 0 as of the date |
| 3 | `sales_crossfoot` | 4000 net movement = invoice totals − returns, for the day |
| 4 | `purchases_crossfoot` | 1100 from purchase documents = invoice totals, for the day |
| 5 | `payments_crossfoot` | 1000/1010/1020 movement = the payment records, for the day |
| 6 | `party_ledgers` | Each party's closing = its 1200/2000 control balance |
| 7 | `gold_ledger_vs_documents` | Per-type `fine_mg` in `gold_ledger` = the source documents, for the day |
| 8 | `gold_stock_consistency` | Cumulative ledger weight = products on hand + booked old gold + unconsumed lots + WIP |

Check 7 compares, per `gold_ledger.type`, the ledger's Σ `fine_mg` for the day
against the documents that should have produced it, scoped to documents
**posted on that day** — batches *approved*, orders *finished*, invoices
created. Gold movement rows are written at approval/finish, not at allocation,
so scoping to the creating row would produce a false failure:

| `gold_ledger.type` | Source document |
|---|---|
| `PURCHASE` | `purchase_invoice_items` (`net_mg × purity.permille`) |
| `OLD_GOLD_PURCHASE` | `old_gold_items.fine_mg` where `status = 'PURCHASED'` |
| `SALE` | `sales_items` joined to `products.fine_gold_mg` |
| `MELTING_INPUT` / `MELTING_OUTPUT` | the batch, `melting_inputs.fine_mg` / `melting_outputs.fine_mg` |
| `MANUFACTURING_INPUT` | `manufacturing_materials.fine_mg` for orders finished that day |
| `MANUFACTURING_OUTPUT` | `manufacturing_outputs` fine gold for orders finished that day |
| `LOSS` | `melting_batches.loss_mg + manufacturing_orders.loss_mg`, both posted that day |

`ADJUSTMENT` and `RECOVERY` are excluded — for those the ledger *is* the
source of record, and §3.6 already ties them to 5300.

Check 8 is the one that answers "reconciles with inventory". It is cumulative
by design, because stock persists across days:

```
Σ gold_ledger.fine_mg (all time, branch)
  = Σ products.fine_gold_mg        where status NOT IN ('SOLD','RETURNED','VOID','LOST','MELTED')
  + Σ old_gold_items.fine_mg       where status IN ('PURCHASED','AVAILABLE','RESERVED_FOR_MELTING')
  + Σ melting_outputs.fine_mg      where batch status != 'VOID', less all fine_mg allocated to
                                    non-void manufacturing orders
  + Σ manufacturing_materials.fine_mg on non-void orders
```

Only **booked** old gold counts. An item in `RECEIVED`, `TESTED`, or `VALUED`
is physically in the shop but has no journal and no ledger row, because the
shop has not bought it yet — buying it is what debits 1100. Including those
statuses would make the check permanently fail. Spec 4's closing screen may
still show "gold awaiting testing" as a memo line read from the old-gold
module, but it is not ledger inventory and is excluded from this check.

Products are counted for every status except the four that mean the gold has
left the shelf or been destroyed, so `RESERVED`, `IN_REPAIR`,
`IN_MANUFACTURING`, and `TRANSFER_PENDING` stock still counts.

Spec 4 gates day close on all eight passing.

## 6. Shared math

`packages/shared/src/accounting.ts` — pure, DB-free, unit-testable, and
reused by specs 2-4:

`businessDate(epochMs, offsetMinutes)` · `addDays(dateStr, n)` ·
`allocateProportional(total, weights)` · `checkBalanced` ·
`computePartyLedger` · `closingCash(opening, cashIn, cashOut)` ·
`cashDifference(expected, actual)` · `meltingLossValue(inputCostCents,
outputFineMg, lossMg)` · `allocateGoldValue(vIn, fineIn, outputsFineMg[])`.

`allocateProportional` generalises the `allocateCharges` currently owned by
`services/purchases.ts:7` — same floor-then-remainder-to-the-first behaviour,
same signature. The shared version becomes the implementation;
`services/purchases.ts` re-exports it under the old name so its existing
callers and tests are unaffected, and `melting.ts` / `manufacturing.ts` import
`allocateProportional` from shared directly. One implementation, not two.

`closingCash` and `cashDifference` are spec 4's, defined now so the arithmetic
is written and tested once.

`allocateProportional` **normalises** — its output always sums to `total`.
`allocateGoldValue` deliberately does **not**: it returns
`round(fine_mg_o / fineIn × vIn)` per output, so the outputs sum to strictly
less than `vIn` and the shortfall *is* the manufacturing loss value. Using
`allocateProportional` here would silently normalise the loss away and make
`mfgLossValue` always zero. The two functions look interchangeable and are
not.

## 7. Data flow example

A melt of old gold bought for 400,000 (LKR 400,000) that yields 10,000 mg
fine out of 10,200 mg fine in, with 100 mg loss:

- `melting_batches.input_cost_cents = 40,000,000`
- `lossValue = round(40,000,000 × 100 / (10,000 + 100)) = 396,039`
- `lotCost = 40,000,000 − 396,039 = 39,603,961`
- Entry: `DR 5100 396,039 / CR 1100 396,039`

Manufacturing then allocates 6,000 mg of that lot, whose book value is
`allocateProportional(39,603,961, [6,000, 4,000])[0] = 23,762,377`. With
labour 30,000 and making 20,000, `extras = 5,000,000`, and one output of
5,950 mg fine:

- `goldValue = round(5,950 / 6,000 × 23,762,377) = 23,564,657`
- `mfgLossValue = 23,762,377 − 23,564,657 = 197,720`
- `cost_cents = 23,564,657 + 5,000,000 = 28,564,657`
- Entry: `DR 1100 5,000,000 / CR 2200 5,000,000` and
  `DR 5200 197,720 / CR 1100 197,720`

Check 8 still balances: 6,000 mg of lot consumed, 5,950 mg into the product,
50 mg into manufacturing loss.

## 8. Testing

**Vitest** — `packages/shared/src/accounting.test.ts` covers the balance
invariant, the timezone offset across a UTC day boundary, pro-rata allocation
with the remainder to the first, melting loss valuation, gold value
allocation, and the party-ledger sign flip between customer and supplier.
`apps/api` gains a reversal test asserting the mirror matches the original and
the original flips to `REVERSED`. The `allocateCharges` re-export keeps its
existing callers and tests green against the shared implementation.

**Live gate:**

1. Chart lists 24 accounts; 1020 opens at zero and 6000 is "Rent & Rates".
2. Create account 6300 "Other Income" via `POST /accounts`; rename it; try to
   deactivate 1000 → `CONFLICT` with its entry count.
3. Post a cash sale → one `JE-` entry, 6 lines, balanced; appears in
   `GET /accounts/journal` and in the 1000 statement's running balance.
4. Post a card sale → 1020 debited, 1010 untouched.
5. Reverse that sale → mirror entry with `reverses_entry_id` set, original
   `REVERSED`, 1020 back to zero, entry count unchanged.
6. Run `/accounts/reconciliation` for today → all eight pass.
7. Melt an old-gold item with a loss → 5100 debited, lot carries
   `cost_cents`; manufacture from it → 5200 and 2200 posted, product
   `cost_cents` = gold value + extras.
8. Customer and supplier ledgers show opening from the backfilled 3100 entry,
   and their closings match 1200 / 2000.
9. Backdate an entry to last week and confirm it lands on that date in the
   journal and in that day's reconciliation, not today.

## 9. Out of scope

Cash sessions and counting, cash/bank opening-balance flow, transfers, card
settlement, bank payments, bank reconciliation, the expenses module, receipt
upload, approvals on expenses, the Daily Closing screen, the day lock and its
authorisation, closing snapshots, audit-trail UI, all report UI, month and
year-end closing, multi-currency, revaluing inventory to the daily rate, and
reclassifying historical card sales.

## 11. Implementation

This spec is delivered as **two plans**, so each is independently reviewable
and testable rather than one 120 KB monolith:

| Plan | Delivers |
|---|---|
| `2026-09-28-goldos-ledger-core-foundation.md` | The ledger exists and is correct: shared math, both migrations, the journal service with reversal, all six posting call sites migrated, chart-of-accounts CRUD, and the journal/trial-balance/statement endpoints. A reviewer can reject "the backfill grouped wrongly" without blocking "the chart is immutable". |
| `2026-09-28-goldos-ledger-postings-reconciliation.md` | The ledger is *complete*: melting loss valued, manufacturing at book cost, gold adjustments valued, shop-local report windows, the eight reconciliation checks, and the documentation update. A reviewer can reject "melting loss valuation" without blocking "shop-local windows". |

The second plan depends on the first being merged; it assumes
`buildEntryStmts`, `businessDateFor`, and migrations 0015/0016 are in place.

## 12. Self-review

- No TBD/TODO. Every account code, posting pair, formula, endpoint, permission,
  and check is stated explicitly.
- Consistent: every posting composes into the caller's `db.batch` with its
  audit row, as `postJournalStmts` already did; the envelope, `requirePerm`,
  `serviceError`, and `{rows, total}` conventions are unchanged. The
  header+line split adds a table but breaks no existing call-site contract.
- Single plan: ledger infrastructure and the postings that make it correct.
  Specs 2, 3, and 4 are separate spec→plan cycles and are named but not
  designed here.
- Unambiguous: card account (1020), the accrual default for manufacturing
  labour (2200), the treatment of historical card sales (left on 1010), the
  melting loss formula's zero case, the exclusion of `ADJUSTMENT` /
  `RECOVERY` from check 7, the rejection of an unrated gold adjustment, and
  the `journal_entry_id` link that makes reversal exact are all pinned.
