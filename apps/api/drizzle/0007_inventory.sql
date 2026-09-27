CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_branch TEXT REFERENCES branches(id),
  to_branch TEXT REFERENCES branches(id),
  weight_mg INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX idx_movements_branch ON stock_movements(to_branch, created_at DESC);
UPDATE products SET status = CASE status
  WHEN 'in_stock' THEN 'IN_STOCK'
  WHEN 'sold' THEN 'SOLD'
  WHEN 'void' THEN 'VOID'
  ELSE 'IN_STOCK' END;
