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

Phase 1 implements the mechanism (atomic D1 batches + append-only audit) but
not the ledger tables. Ledger schema and posting rules are designed in Phase 2;
no Phase-1 code will need rewriting — new tables and services plug into the
existing batch + audit pattern.
