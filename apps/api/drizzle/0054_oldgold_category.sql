-- 0054_oldgold_category.sql
-- Old gold is filed under one of the shop's old gold categories (named OLD GOLD …).
-- Kept in its own table so existing items and re-runs of this migration are safe.
CREATE TABLE IF NOT EXISTS old_gold_item_categories (
  item_id TEXT PRIMARY KEY REFERENCES old_gold_items(id),
  category_id TEXT NOT NULL REFERENCES categories(id)
);
