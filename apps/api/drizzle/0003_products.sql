CREATE TABLE products (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  purity_id TEXT NOT NULL REFERENCES purities(id),
  name TEXT NOT NULL,
  gross_weight REAL NOT NULL,
  stone_weight REAL NOT NULL DEFAULT 0,
  net_weight REAL NOT NULL,
  making_charge REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_stock',
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_branch_status ON products(branch_id, status);
INSERT INTO permissions (id, name) VALUES ('products:read', 'products:read'), ('products:write', 'products:write');
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'products:read'), ('admin', 'products:write'),
  ('manager', 'products:read'), ('manager', 'products:write'),
  ('cashier', 'products:read');
