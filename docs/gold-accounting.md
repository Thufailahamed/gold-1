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
| Sale | DR 1000 cash · DR 1020 card · DR 1010 bank/other · DR 1200 credit *(customer)* · CR 4000 · DR 5000 cost · CR 1100 cost |
| Sale return | the mirror; a card refund credits 1020 |
| Purchase receive | DR 1100 / CR 2000 *(supplier)* |
| Purchase payment | DR 2000 / CR 1000 or 1010 |
| Purchase void | a **reversal** of the receive, linked, not a mirror |
| Old-gold purchase | DR 1100 value / CR 1000 paid + CR 1200 remainder *(customer)* |
| Melting loss | DR 5100 / CR 1100, at book cost |
| Manufacturing finish | DR 1100 extras / CR 2200 (or 1000/1010 when paid on the spot) · DR 5200 loss / CR 1100 |
| Gold adjustment | DR 5300 / CR 1100 for a loss, the reverse for a surplus |
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

`GET /accounts/reconciliation` runs 15 checks: per-entry balance, trial balance,
and cross-foots for sales, purchases, payments, party ledgers, each gold
movement type, and cumulative stock on hand. A failing check is a `200` with
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
