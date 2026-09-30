-- 0038_transfer_recall_gold.sql
-- Recalling an in-transit transfer line returned the piece to the sender's
-- shelf but never reversed the dispatch's gold TRANSFER row, so the ledger
-- kept that metal at the receiver forever: the sender held gold its ledger
-- did not, and the receiver's ledger held gold it never got. recallLines now
-- posts the reversal (ref_entity 'transfer_recall'); this backfills history.
--
-- Each reversal mirrors its own dispatch row exactly (same weight, purity and
-- fine), with source and destination swapped. Idempotent: lines that already
-- have a transfer_recall row are skipped.
INSERT INTO gold_ledger (
  id, occurred_at, branch_id, source, destination, type,
  weight_mg, permille, fine_mg, ref_entity, ref_id,
  product_id, old_gold_id, user_id, notes, created_at, created_by
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  gl.occurred_at,
  t.from_branch_id,
  gl.destination,
  gl.source,
  'TRANSFER',
  gl.weight_mg,
  gl.permille,
  gl.fine_mg,
  'transfer_recall',
  l.id,
  gl.product_id,
  NULL,
  gl.user_id,
  'Backfill: gold return for recalled transfer ' || t.number,
  gl.created_at,
  gl.created_by
FROM transfer_lines l
JOIN transfers t ON t.id = l.transfer_id
JOIN gold_ledger gl ON gl.ref_entity = 'transfer_line' AND gl.ref_id = l.id
WHERE l.status = 'RECALLED'
  AND NOT EXISTS (
    SELECT 1 FROM gold_ledger r WHERE r.ref_entity = 'transfer_recall' AND r.ref_id = l.id
  );
