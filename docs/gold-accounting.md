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

Gold ledger tables (grams in/out per process) arrive with old gold /
melting / manufacturing phases.
