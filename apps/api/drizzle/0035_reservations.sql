-- 0035_reservations.sql
-- A piece held for a customer. RESERVED has always been a product status
-- (dashboards, filters and the monthly valuation count it) but nothing could
-- put a piece there. The hold lives on the product row so the tag lookup, the
-- POS and the product page all see who it is for and until when; the history
-- lives in stock_movements (RESERVE / RELEASE) like every other status change.
-- All columns are cleared when the hold ends — released or sold.
ALTER TABLE products ADD COLUMN reserved_customer_id TEXT REFERENCES customers(id);
ALTER TABLE products ADD COLUMN reserved_note TEXT;
ALTER TABLE products ADD COLUMN reserved_until INTEGER;
ALTER TABLE products ADD COLUMN reserved_at INTEGER;
ALTER TABLE products ADD COLUMN reserved_by TEXT REFERENCES users(id);
CREATE INDEX idx_products_reserved_customer ON products(reserved_customer_id) WHERE reserved_customer_id IS NOT NULL;
