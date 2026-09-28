CREATE TABLE gold_movements_new (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  old_gold_id TEXT REFERENCES old_gold_items(id),
  direction TEXT NOT NULL,
  fine_mg INTEGER NOT NULL,
  purity_permille INTEGER NOT NULL,
  ref_entity TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  CHECK (product_id IS NOT NULL OR old_gold_id IS NOT NULL)
);
INSERT INTO gold_movements_new (id, product_id, old_gold_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by)
  SELECT id, product_id, NULL, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by FROM gold_movements;
DROP TABLE gold_movements;
ALTER TABLE gold_movements_new RENAME TO gold_movements;
CREATE INDEX idx_gold_product ON gold_movements(product_id, created_at DESC);
CREATE INDEX idx_gold_ref ON gold_movements(ref_entity, ref_id);
CREATE INDEX idx_gold_oldgold ON gold_movements(old_gold_id, created_at DESC);
