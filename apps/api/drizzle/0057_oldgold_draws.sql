-- 0057_oldgold_draws.sql
-- Products come from old gold on hand. Each piece records which old gold it
-- drew its metal from and how much, so a void can put the metal back. An old
-- gold item drawn down to nothing is DRAWN, which takes it out of the pool.
CREATE TABLE IF NOT EXISTS old_gold_draws (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  old_gold_id TEXT NOT NULL REFERENCES old_gold_items(id),
  net_mg INTEGER NOT NULL CHECK (net_mg > 0),
  fine_mg INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  reversed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_og_draws_product ON old_gold_draws(product_id);
CREATE INDEX IF NOT EXISTS idx_og_draws_item ON old_gold_draws(old_gold_id);
