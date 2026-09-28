-- Align historical melt rows with the branch-source convention that
-- gold_stock_consistency reads: a branch source means gold left branch stock.
-- MELTING_INPUT rows sourced old-gold:<id> and melt LOSS rows sourced
-- melting:<batch> contributed zero outflow to the directional sum, so every
-- historical melt overstated ledger gold by its input (and loss) weight.
-- Manufacturing LOSS rows are intentionally untouched: that flow balances
-- through lot-remainder mechanics and its loss never enters held stock.
UPDATE gold_ledger
SET source = 'branch:' || (SELECT b.branch_id FROM melting_batches b WHERE b.id = gold_ledger.ref_id)
WHERE type = 'MELTING_INPUT'
  AND source LIKE 'old-gold:%'
  AND EXISTS (SELECT 1 FROM melting_batches b WHERE b.id = gold_ledger.ref_id AND b.branch_id IS NOT NULL);
UPDATE gold_ledger
SET source = 'branch:' || (SELECT b.branch_id FROM melting_batches b WHERE b.id = gold_ledger.ref_id)
WHERE type = 'LOSS'
  AND ref_entity = 'melting_batch'
  AND source LIKE 'melting:%'
  AND EXISTS (SELECT 1 FROM melting_batches b WHERE b.id = gold_ledger.ref_id AND b.branch_id IS NOT NULL);
