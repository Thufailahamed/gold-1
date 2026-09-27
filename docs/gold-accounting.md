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

Financial books are live since the ledgers phase: `chart_of_accounts` (11
seeded accounts) + append-only `journal_entries` in integer cents.
`postJournal` validates balance (ΣDR == ΣCR) and active accounts, returning
statements that compose into business batches — purchases will post
DR 1100 Gold Inventory / CR 2000 Supplier Payables (+ DR 2000 / CR 1000 Cash
on payment) in the same atomic batch as inventory, ledger, and audit rows.
Party balances are derived: customer = opening + DR − CR on 1200;
supplier = opening + CR − DR on 2000. Manual corrections go through
`POST /accounts/adjustments` (reason required, accounts:manage).

## Sale postings (live)

Counter sale posts in the invoice batch: DR per payment leg (1000 Cash /
1010 Card-Bank-Other / 1200 Receivable with customer party) / CR 4000
Revenue; DR 5000 COGS (cost snapshots incl. allocated charges) / CR 1100
Inventory. Each item writes a `gold_movements` OUT row (fine mg +
permille) — the future gold ledger absorbs these rows. Returns post the
mirror (DR 4000 / CR original methods or 1200 store credit; DR 1100 /
CR 5000) plus gold IN rows. Original sales are never modified.

Gold ledger tables (melting/recovery/manufacturing flows) still arrive
with their phases.

## Purchase postings (live)

Receive/direct invoice posts in the invoice batch: DR 1100 Gold Inventory /
CR 2000 Supplier Payables (both tagged with the supplier party, so the
supplier ledger updates automatically); payment posts DR 2000 / CR 1000 Cash
or 1010 Bank. Void posts the mirror reversal DR 2000 / CR 1100. Additional
charges are folded into each item's `cost_cents` by net-weight share, so
inventory valuation already includes freight and handling.
