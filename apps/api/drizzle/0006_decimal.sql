ALTER TABLE purities ADD COLUMN permille INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purities ADD COLUMN default_making_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purities ADD COLUMN default_wastage_mg INTEGER NOT NULL DEFAULT 0;
UPDATE purities SET permille = CAST(ROUND(purity * 1000) AS INTEGER), default_making_cents = CAST(ROUND(default_making_charge * 100) AS INTEGER), default_wastage_mg = 0;
ALTER TABLE purities DROP COLUMN purity;
ALTER TABLE purities DROP COLUMN default_making_charge;
ALTER TABLE purities DROP COLUMN default_wastage_pct;
ALTER TABLE gold_rates ADD COLUMN rate_cents_per_g INTEGER NOT NULL DEFAULT 0;
UPDATE gold_rates SET rate_cents_per_g = CAST(ROUND(rate_per_gram * 100) AS INTEGER);
ALTER TABLE gold_rates DROP COLUMN rate_per_gram;
ALTER TABLE suppliers ADD COLUMN credit_limit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0;
UPDATE suppliers SET credit_limit_cents = CAST(ROUND(credit_limit * 100) AS INTEGER), opening_balance_cents = CAST(ROUND(opening_balance * 100) AS INTEGER);
ALTER TABLE suppliers DROP COLUMN credit_limit;
ALTER TABLE suppliers DROP COLUMN opening_balance;
ALTER TABLE customers ADD COLUMN credit_limit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0;
UPDATE customers SET credit_limit_cents = CAST(ROUND(credit_limit * 100) AS INTEGER), opening_balance_cents = CAST(ROUND(opening_balance * 100) AS INTEGER);
ALTER TABLE customers DROP COLUMN credit_limit;
ALTER TABLE customers DROP COLUMN opening_balance;
ALTER TABLE products ADD COLUMN sku TEXT;
ALTER TABLE products ADD COLUMN subcategory_id TEXT REFERENCES subcategories(id);
ALTER TABLE products ADD COLUMN design_id TEXT REFERENCES designs(id);
ALTER TABLE products ADD COLUMN product_type_id TEXT REFERENCES product_types(id);
ALTER TABLE products ADD COLUMN metal_type_id TEXT NOT NULL DEFAULT 'metal-gold';
ALTER TABLE products ADD COLUMN stone_type_id TEXT REFERENCES stone_types(id);
ALTER TABLE products ADD COLUMN gross_mg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN stone_mg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN net_mg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN fine_gold_mg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN making_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN wastage_mg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN cost_cents INTEGER;
ALTER TABLE products ADD COLUMN selling_price_cents INTEGER;
ALTER TABLE products ADD COLUMN location TEXT;
ALTER TABLE products ADD COLUMN notes TEXT;
ALTER TABLE products ADD COLUMN image_keys TEXT NOT NULL DEFAULT '[]';
UPDATE products SET
  sku = 'SKU-' || SUBSTR(UPPER(HEX(RANDOMBLOB(3))), 1, 6),
  metal_type_id = 'metal-gold',
  gross_mg = CAST(ROUND(gross_weight * 1000) AS INTEGER),
  stone_mg = CAST(ROUND(stone_weight * 1000) AS INTEGER),
  net_mg = CAST(ROUND(net_weight * 1000) AS INTEGER),
  fine_gold_mg = CAST(ROUND(CAST(ROUND(net_weight * 1000) AS INTEGER) * (SELECT permille FROM purities WHERE purities.id = products.purity_id) / 1000.0) AS INTEGER),
  making_cents = CAST(ROUND(making_charge * 100) AS INTEGER),
  wastage_mg = 0,
  image_keys = '[]';
CREATE UNIQUE INDEX idx_products_sku ON products(sku);
ALTER TABLE products DROP COLUMN gross_weight;
ALTER TABLE products DROP COLUMN stone_weight;
ALTER TABLE products DROP COLUMN net_weight;
ALTER TABLE products DROP COLUMN making_charge;
