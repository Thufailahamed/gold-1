-- Backfill gold_ledger OLD_GOLD_PURCHASE rows for old-gold items bought before
-- the live-ledger write existed in purchaseItem (which only wrote legacy
-- gold_movements). Without these rows gold_stock_consistency and the
-- OLD_GOLD_PURCHASE cross-foot fail by exactly the unbought weight.
-- Idempotent: skips items that already have a matching ledger row, items
-- without a tested purity or net weight, and unvalued items. Melted items
-- are included deliberately: their MELTING_INPUT rows already exist, and an
-- input without its purchase inflow is the same hole.
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
  COALESCE(ogp.created_at, oi.created_at),
  oi.branch_id,
  'customer:' || oi.customer_id,
  'branch:' || oi.branch_id,
  'OLD_GOLD_PURCHASE',
  oi.net_mg,
  oi.tested_permille,
  oi.fine_mg,
  'old_gold_purchase',
  ogp.id,
  NULL,
  oi.id,
  COALESCE(ogp.created_by, oi.created_by),
  'Backfill: pre-ledger old-gold purchase ' || oi.number,
  ogp.created_at,
  COALESCE(ogp.created_by, oi.created_by)
FROM old_gold_items oi
JOIN old_gold_purchases ogp ON ogp.item_id = oi.id
WHERE oi.status IN ('PURCHASED', 'AVAILABLE', 'RESERVED_FOR_MELTING', 'MELTED')
  AND oi.tested_permille IS NOT NULL AND oi.tested_permille > 0 AND oi.tested_permille <= 1000
  AND oi.net_mg > 0 AND oi.fine_mg > 0
  AND NOT EXISTS (
    SELECT 1 FROM gold_ledger gl
    WHERE gl.type = 'OLD_GOLD_PURCHASE' AND gl.old_gold_id = oi.id
  );
