-- 0058_oldgold_draw_status.sql
-- Old gold a product is made from can be bought (PURCHASED, as a till sale leaves
-- it) or on the shelf (AVAILABLE). Record which, so a void puts the item back
-- where it was.
ALTER TABLE old_gold_draws ADD COLUMN from_status TEXT NOT NULL DEFAULT 'AVAILABLE';
