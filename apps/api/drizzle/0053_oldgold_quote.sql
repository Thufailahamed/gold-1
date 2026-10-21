-- 0053_oldgold_quote.sql
-- A price per gram can be typed when old gold is taken in. The price is the
-- net weight times that rate, and it becomes the value of the item when it is
-- valued (unless an override is given). Kept in its own table, so items
-- without a quote are untouched.
CREATE TABLE IF NOT EXISTS old_gold_quotes (
  item_id TEXT PRIMARY KEY REFERENCES old_gold_items(id),
  rate_cents_per_g INTEGER NOT NULL CHECK (rate_cents_per_g > 0),
  created_at INTEGER NOT NULL
);
