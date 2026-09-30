# GoldOS Gold Accounting

Gold is a first-class asset, not a product quantity. Every movement records:

- Gross weight, stone weight, net weight
- Purity and karat
- Fine-gold equivalent (net × purity)
- Gold rate at transaction time
- Source → destination (supplier, old-gold lot, melting batch, manufacturing
  job, sale, adjustment)
- Wastage, recovery, loss

## Dual ledgers

- **Financial ledger (LKR):** sales → purchases → expenses → cash → bank →
  receivables → payables → profit.
- **Gold ledger (grams):** purchase → old gold → melting → manufacturing →
  sale → adjustment.

A single transaction may post to both. Example SALE: invoice + payment +
inventory decrease + gold decrease + revenue entry + COGS entry + audit event,
all in one atomic batch. If any step fails, everything rolls back.

## Status

Financial books are live. The journal is a **header + lines** ledger: one
`journal_entries` row per transaction with its `entry_no` and shop-local
`entry_date`, and one `journal_lines` row per leg. `buildEntryStmts` validates
balance (ΣDR == ΣCR), active accounts and the date, and returns statements
that compose into business batches — so a posting is atomic with the document
that caused it and with its audit row.

`chart_of_accounts` holds 24 accounts. Accounts the ledger posts into are
marked `is_system` and reject edits, as does any account with journal history.

Every transaction posts itself. Nothing is keyed twice:

| Flow | Posting |
|---|---|
| Sale | DR 1000 cash · DR 1020 card · DR 1010 bank/other · DR 1200 credit *(customer)* · CR 4000 net · CR 2100 output tax · DR 5000 cost · CR 1100 cost |
| Sale return | the mirror, refunding exactly the tax each returned line carried (DR 2100); a card refund credits 1020 |
| Purchase receive | DR 1100 / CR 2000 *(supplier)* |
| Purchase payment | DR 2000 / CR 1000 or 1010 |
| Purchase void | a **reversal** of the receive, linked, not a mirror |
| Old-gold purchase | DR 1100 value / CR 1000 paid + CR 1200 remainder *(customer)* |
| Melting loss | DR 5100 / CR 1100, at book cost |
| Manufacturing finish | DR 1100 extras / CR 2200 (or 1000/1010 when paid on the spot) · DR 5200 loss / CR 1100 |
| Gold adjustment | DR 5300 / CR 1100 for a loss, the reverse for a surplus |
| Direct stock intake | DR 1100 / CR 3100 at book cost; a cost correction posts the difference, a void the reverse |
| Tax payment | DR 2100 / CR 1000 or the named bank account |
| Manual adjustment | as entered, with a required reason |

Party balances are derived, never stored: customer = opening + DR − CR on 1200;
supplier = opening + CR − DR on 2000. The opening itself is an entry against
3100, not a column.

### Corrections

Nothing is ever edited or deleted. A mistake is corrected with a **reversing
entry**: the original's lines with debit and credit swapped,
`reverses_entry_id` set, and the original flipped to `REVERSED`. A void
reverses the entry its own document recorded (`journal_entry_id`), which is why
a purchase void no longer needs to guess from `ref_entity`/`ref_id` — it shares
both with the receive it reverses.

Voiding a purchase that already has payments against it is refused: a void
reverses the receive only, so the payment would survive as a genuine payable
and the money would silently disappear from the inventory side.

## Cash and bank

Cash needs no table of its own: one `1000` per branch is already what the
ledger models, because every entry carries `branch_id`. Bank accounts do need
one, because a shop with two banks has to be able to reconcile them separately.

| Flow | Posting |
|---|---|
| Bank opening balance | `DR <account> / CR 3100` |
| Cash deposit | `DR <account> / CR 1000` |
| Cash withdrawal | `DR 1000 / CR <account>` |
| Branch transfer — sent | `CR 1000` at the **from** branch / `DR 1030` |
| Branch transfer — received | `DR 1000` at the **to** branch / `CR 1030` |
| Card settlement | `DR <account> net / CR 1020 gross / CR 6060 fee` |
| Supplier payment | `CR <the named bank account>` |

A payment names a registered bank account rather than picking `1000` or `1010`
by a free-text method, and the resolved account code is stored on the payment
so the historical record still says where the money went.

### A transfer is two entries

A journal entry has exactly one `branch_id`. Attributing a cross-branch
movement to either branch would make the other branch's cash wrong by the full
amount, so dispatch and receipt are separate entries linked by
`cash_transfers`. Between them the money rests in **1030 Cash in Transit** rather than
silently missing from both branches. A transfer moves money *within* the shop,
so no total changes — but double-entry still has to balance, and the money
genuinely is between the two branches until it arrives. Dispatch and receipt are separate
endpoints because in reality they happen at different times in different
places.

### Card settlement

The gross the shop took is not the net the acquirer pays. `1020` falls by the
**full gross**, the bank rises by only the **net**, and the difference the
acquirer withheld is booked to **6060 Bank & Card Charges** — not absorbed.
Losing that fee is how a shop quietly under-makes on card turnover. Whatever
is left in `1020` at close is what the acquirer still owes, which is the whole
point of clearing through `1020` rather than booking card sales straight to
bank.

### Bank reconciliation

Recording a statement balance shows the difference and the entries after the
statement date. It does not fix anything: a correcting entry is a manual
adjustment under `accounts:manage`, the rule that already applies to
corrections. There is no statement import and no auto-matching — a shop
turning over LKR 30,000 a day reconciles by eye faster than it configures a
parser.

## Expenses

`DR <category account> / CR <payment account>` — cash is `1000` at the
spending branch, a bank payment is that bank's own account code.

The cost lands on the branch that **incurred** it, not the branch whose cash
paid it. A head-office invoice paid from the main bank is a cost of the branch
that spent it, not a movement of that branch's cash. The entry's `branch_id` is
the incurred branch; the credit leg is resolved independently.

Each category owns its own ledger account — nine seeded against the accounts
the ledger core created — so the P&L breaks out by category with no report
having to split an account.

| Above | Receipt | Approval | Ledger |
|---|---|---|---|
| the approval threshold | per the receipt threshold | **required** | posts only on approval |
| both | **required** | — | — |

Self-approval is refused in both directions. A rejection is never a delete.

### An unapproved expense makes cash read high

**This is the one to remember.** The money has physically left the bank, but
the ledger has not recorded it until approval. Between the two, `1000`/`1010`
read higher than the drawer holds, and a daily closing will report that as a
cash difference that is not a counting error.

`expenses_crossfoot` is unaffected — it compares *ledger* movement to *POSTED*
expenses, so a pending expense is on neither side and the check stays true.
That is deliberate: making the check fail would punish the shop for an expense
it has not approved yet, and counting pending expenses would make the check
pass and hide the discrepancy.

**Spec 4 inherits a hard requirement: the closing screen must show expenses
awaiting approval for the day alongside expected cash.** Without that line,
every evening closing after a large unapproved purchase looks like a till
shortage.

## Daily closing

One close per branch per day. Cash is a physical thing in a specific place, so
a combined figure is not something anyone can count.

```
Opening Cash        = Σ(1000 movement) where entry_date < the day, this branch
Cash In             = Σ(debits to 1000)
Cash Out            = Σ(credits to 1000)
Expected Closing    = Opening + Cash In − Cash Out
Actual Closing      = what the shop counted
Cash Difference     = Actual − Expected
```

Opening cash is read from the **ledger**, not carried from yesterday's count,
so the screen reconciles against the books rather than against itself and a
wrong opening is caught instead of propagated. It also works on the first day
and after a missed close.

### The unclassified guard

Every cash line is classified by the entry's `ref_entity`:

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
| Out | `old_gold_purchase` | Old gold purchases |

A movement not on that list appears as **Unrecognised** and **blocks the
close**. That guard is the whole reason the breakdown can be believed: without
it the screen would quietly report a wrong number whenever someone added a new
cash flow, and the shop would reconcile against it — which is precisely the
manual work this exists to remove. It found `old_gold_purchase` on its first
run.

### The gate

A day may be closed only when **all 19 reconciliation checks pass** for that
branch and date, no cash is unrecognised, and a difference carries an
explanation. The close records which checks it saw and freezes the whole screen
into `report_json`.

A closed day rejects new postings — see the lock in `database.md`. It covers
backdating too.

### Re-opening

Re-opening needs a written reason and an approver who is **neither the
requester nor whoever closed the day**. The close row is kept; a `day_reopens`
row records who asked, who approved and why. A day reopened twice has two rows.

### The count, the card terminal and the correction

The count can be entered as a note-and-coin sheet (`denominations`, LKR face
value → pieces); the sheet must add up to `actualCents` exactly and is kept
on the close. The card terminal's end-of-day total (`cardTerminalCents`) is
compared with the card sales the ledger recorded for the day; a card
difference needs an explanation like a cash one. A cash difference and a card
difference that cancel out are a sale keyed with the wrong payment method.

With `postDifference`, the close posts the difference to **6090 Cash Short &
Over** (`ref_entity` `cash_correction`, `ref_id` the closing) in the same
batch, so the ledger drawer becomes the counted drawer and tomorrow's opening
is what is really there. On a re-close the earlier correction is already a
cash movement of the day, so only the change posts; `correction_cents` holds
the total.

### Finding missing amounts

`GET /day-closings/investigate?branchId&date&actualCents` is read-only and
answers "where did it go": failing checks with both figures, **every document
of the day that is not posted the way it says** (no entry, revenue ≠ invoice
net, money legs ≠ total, payments ≠ total, and the same for returns,
purchases, supplier payments, expenses and receipts), every drawer movement
with who keyed it and when, movements keyed on another day, expenses awaiting
approval, transfers sent here but not received, and the single movements or
pairs whose size equals the difference exactly. It never corrects anything.

### Reports

- `GET /day-closings/report.csv` — the day's report as a spreadsheet (frozen
  when closed, a labelled live preview otherwise); the web app prints the same
  report at `/day-closing/report`.
- `GET /day-closings/unclosed` — days with activity nobody closed, or reopened
  and not re-closed.
- `GET /day-closings/variance` — shortages and overages over a window, by
  branch and by who closed.
- `GET /day-closings/summary?date` — every branch for one day.

The report also carries the branch's fine-gold balance (opening, in, out,
closing, by the stock-consistency direction rule) and the card takings.

### The awaiting-approval line

**An unapproved expense has left the bank but is not in the ledger**, so the
books read high by exactly that amount. The closing screen shows *expenses
awaiting approval* above the arithmetic for exactly this reason: without it,
every evening after a large unapproved purchase looks like a till shortage.
`expenses_crossfoot` is unaffected — a pending expense is on neither side, so
the check stays true, and that is deliberate.

## Sales tax (VAT)

Off by default (`sales_tax_rate_bp` = 0). When the shop sets a rate, tax is
**added on top** of each line's after-discount price, rounded per line, and
the customer pays the gross. Revenue (4000) is always the net; the tax is the
authority's money and goes to **2100 Tax Payable**. The line tax is stored on
`sales_items.tax_cents` and the invoice keeps its rate in `tax_rate_bp`, so a
return refunds exactly what that line carried — never a re-derived figure at
today's rate — and a reprinted invoice still states the rate it was issued at.

`sales_crossfoot` compares 4000 with the documents **net of tax**, and
`tax_crossfoot` compares 2100's sale-side movement with the invoices' and
returns' tax. Repair collections also credit 4000 but have no sales document,
so they are kept off the journal side — counting them failed the check, and
blocked the close, on every day with a repair collection. A custom-order
delivery taxes the quote per piece, so the balance due is
`quote + tax − advances`.

The VAT return (`GET /accounts/tax/report`) reads 2100 directly: opening,
charged, refunded, paid, closing. A payment (`POST /accounts/tax/payments`,
ref `tax_payment`, a known cash ref for the day close) cannot exceed what 2100
holds. Input tax on purchases is **not** modelled: gold bought from the public
carries none, and the purchase cost chain stays tax-free.

## Accounts payable

`GET /accounts/payables` mirrors customer dues: supplier balances from 2000
(credit positive) with the unpaid purchase invoices behind them aged. Voided
invoices, and invoices whose receive entry was reversed, owe nothing. Payment
stays on the purchase invoice.

## Financial year

The year starts in `fiscal_year_start_month` (default 4, April — Sri Lanka's
year of assessment). **Closing posts nothing.** The balance sheet derives
Retained earnings (profit of every entry before the current year) and Current
year profit, so no P&L reader — monthly, day close, reconciliation, the
statements — has to learn to skip a closing entry, and the equity total is
identical either way.

What a close does is **lock** every posting dated on or before the year end,
at every branch (checked in `buildEntryStmts`, beside the day lock), and
freeze the year's P&L and balance sheet into `fiscal_closes.report_json`. It
is refused for a date that is not a year end, a year not yet over, or books
that do not balance. Reopening needs a reason and a second person with
`accounts:manage` who is neither the requester nor the closer; only the latest
closed year can be reopened.

## Opening stock

A product taken in directly (`POST /products`, not a purchase or a
manufacture) posts **DR 1100 / CR 3100 Opening Balances** at its book cost in
the same batch as its OPENING gold row. Before this, 1100 understated by every
such piece until it sold, then went negative by its COGS. A cost correction on
a piece still on the shelf posts the difference; a void posts the reverse of
the carried value **and an OPENING gold row out** (`branch → opening`) —
without it a voided piece left stock on hand while its intake inflow stayed,
and `gold_stock_consistency` failed for good. `POST
/accounts/opening-stock/backfill` brings earlier direct intake onto the books,
idempotently.

## Book cost chain

Gold inventory is carried at **what the shop actually paid**, never at the day's
board rate. The trace is complete and every link is a book cost:

```
old_gold_items.purchase_value_cents   (or purchase_invoice_items.cost_cents)
  → melting_outputs.cost_cents        (input cost less the value of gold lost)
    → manufacturing_outputs.cost_cents (lot value + capitalised extras)
      → products.cost_cents
        → sales_items.cost_cents      (snapshotted at sale)
          → DR 5000 / CR 1100
```

A melt's loss is `input_cost_cents × loss_mg / (output_fine_mg + loss_mg)` and
the lot carries the remainder. Manufacturing allocates each lot's value with the
two weights summing to the lot's full fine weight, then values each output at
`round(fine_mg_o / fineIn × vIn)` — deliberately **not** normalised, because the
shortfall from `vIn` is the manufacturing loss and normalising would discard it.

A shop buying at 8,000/g with the rate at 9,000/g carries inventory at 8,000/g
and reports the margin it actually made.

**Melting labour and making charges** accrue to 2200 Other Payables by default,
not to cash. Assuming cash would invent a cash movement that did not happen and
would put the daily closing's expected cash permanently out. `POST
/manufacturing/orders/:id/finish` takes an optional `{paidFrom: "cash" |
"bank"}` for jobs settled on the spot.

## Loss accounts

| Account | What it holds |
|---|---|
| 5100 Gold Melting Loss | fine gold lost in melting, at book cost |
| 5200 Gold Manufacturing Loss | fine gold lost in manufacture, at book cost |
| 5300 Gold Adjustment Loss | **net** gold variance from stock counts — debited for shrinkage, credited for a surplus or a recovery, so it always reads as net variance |

A gold adjustment carries a weight but no money, so its value is derived from
the effective rate for its purity. **If no rate exists the adjustment is
refused**: a guessed loss is worse than no loss, because it writes a wrong
number into the books that nothing can later distinguish from a real one.

## Money and gold reconcile separately

Money reconciles in **cents** and gold in **fine milligrams**. No check ever
compares a weight to a money amount, because inventory is carried at book cost
and is never revalued to the daily rate.

Gold direction is read from the ledger row: a `destination` of
`branch:<id>` means gold arrived, a `source` of `branch:<id>` means it left.
Summing every row instead would count a sale and a loss as stock still on the
shelf.

`GET /accounts/reconciliation` All 19 must pass for a branch and date before that day can close. They
are branch-scopable, and a per-branch run exercises code paths the
shop-wide run does not. `reconcile` runs 19 checks: per-entry balance, trial balance, and cross-foots
for sales, output tax, purchases, payments, party ledgers, card clearing, cash in
transit, expenses, each gold movement type, and cumulative stock on hand. A failing check is a `200` with
`passed: false` and the offending figures, not an error — the caller needs the
whole report to show the operator what is out.

## Gold ledger + melting (live)

`gold_ledger` is the unified record: every entry carries occurred_at,
branch, source → destination, one of 12 types, weight, permille, fine,
ref, optional product/old-gold links, user, and notes. Backfilled from
`gold_movements` (SALE/RETURN/OLD_GOLD_PURCHASE); `gold_movements` keeps
dual-writing until cutover. Melting approval posts MELTING_INPUT per item
(old-gold → batch), MELTING_OUTPUT per lot (batch → branch), plus LOSS or
RECOVERY rows — differences are never silent. `GET /gold/lineage` walks
old gold → batch → lots → products → sales in both directions.

## Old-gold postings (live)

Counter purchase posts in the purchase batch: DR 1100 Gold Inventory (full
value, customer party) / CR 1000 Cash or 1010 Bank (paid) + CR 1200
Receivables with the customer party (remainder owed — shows as credit
balance on the customer ledger). Plus a `gold_movements` IN row (fine mg +
permille, linked via `old_gold_id`) feeding the future melting pool, plus
audit. Convert-to-product creates a normal JW- intake (cost = purchase
value) and links both directions — full lineage from OG- number to shelf
barcode.

Counter sale posts in the invoice batch: DR per payment leg (1000 Cash /
1010 Card-Bank-Other / 1200 Receivable with customer party) / CR 4000
Revenue; DR 5000 COGS (cost snapshots incl. allocated charges) / CR 1100
Inventory. Each item writes a `gold_movements` OUT row (fine mg +
permille) — the future gold ledger absorbs these rows. Returns post the
mirror (DR 4000 / CR original methods or 1200 store credit; DR 1100 /
CR 5000) plus gold IN rows. Original sales are never modified.

Gold ledger tables (melting/recovery/manufacturing flows) still arrive
with their phases.

## Manufacturing postings (live)

Finish posts in one batch: MANUFACTURING_INPUT per allocated lot
(melting-lot → order, lot weight + allocated fine), MANUFACTURING_OUTPUT
per finished product (order → branch, net weight + fine), LOSS if > 0.
Finished cost = allocated-fine share of gold at board rate on finish day +
labour/making/stones share. Lineage: lot → MO → JW- products walks both
directions via `GET /gold/lineage`.

## Purchase postings (live)

Receive/direct invoice posts in the invoice batch: DR 1100 Gold Inventory /
CR 2000 Supplier Payables (both tagged with the supplier party, so the
supplier ledger updates automatically); payment posts DR 2000 / CR 1000 Cash
or 1010 Bank. Void posts the mirror reversal DR 2000 / CR 1100. Additional
charges are folded into each item's `cost_cents` by net-weight share, so
inventory valuation already includes freight and handling.
