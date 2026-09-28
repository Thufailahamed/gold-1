-- Align historical MELTING_INPUT rows with the branch-source convention that
-- gold_stock_consistency reads: a branch source means gold left branch stock.
-- Rows sourced old-gold:<id> contributed zero outflow to the directional sum,
-- so every historical melt overstated ledger gold by its input weight.
-- Melt LOSS rows are intentionally untouched: the loss never sits in held
-- stock on either side (the item already left as MELTED, the lot carries
-- only the remainder), so a branch-sourced LOSS would break the check by
-- exactly the loss weight — verified live. Same shape as manufacturing LOSS.
UPDATE gold_ledger
SET source = 'branch:' || (SELECT b.branch_id FROM melting_batches b WHERE b.id = gold_ledger.ref_id)
WHERE type = 'MELTING_INPUT'
  AND source LIKE 'old-gold:%'
  AND EXISTS (SELECT 1 FROM melting_batches b WHERE b.id = gold_ledger.ref_id AND b.branch_id IS NOT NULL);
