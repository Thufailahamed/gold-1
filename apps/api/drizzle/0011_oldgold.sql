INSERT INTO counters (name, next) VALUES ('OG', 1);
CREATE TABLE old_gold_items (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  item_type TEXT NOT NULL,
  description TEXT NOT NULL,
  gross_mg INTEGER NOT NULL,
  stone_mg INTEGER NOT NULL DEFAULT 0,
  net_mg INTEGER NOT NULL,
  purity_id TEXT REFERENCES purities(id),
  tested_permille INTEGER,
  karat TEXT,
  fine_mg INTEGER NOT NULL DEFAULT 0,
  rate_cents_per_g INTEGER,
  buy_pct REAL,
  purchase_rate_cents INTEGER,
  stone_deduction_cents INTEGER NOT NULL DEFAULT 0,
  processing_deduction_cents INTEGER NOT NULL DEFAULT 0,
  negotiated_cents INTEGER,
  purchase_value_cents INTEGER,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  converted_product_id TEXT REFERENCES products(id),
  staff_id TEXT REFERENCES users(id),
  notes TEXT,
  image_keys TEXT NOT NULL DEFAULT '[]',
  doc_keys TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_og_customer ON old_gold_items(customer_id, created_at DESC);
CREATE INDEX idx_og_status ON old_gold_items(status, branch_id);
CREATE TABLE gold_tests (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES old_gold_items(id),
  method TEXT NOT NULL,
  tested_permille INTEGER NOT NULL,
  tester_id TEXT NOT NULL REFERENCES users(id),
  result TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE old_gold_purchases (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES old_gold_items(id),
  value_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO permissions (id, name) VALUES
  ('oldgold:view', 'oldgold:view'), ('oldgold:create', 'oldgold:create'),
  ('oldgold:edit', 'oldgold:edit'), ('oldgold:cancel', 'oldgold:cancel'),
  ('oldgold:export', 'oldgold:export'), ('oldgold:approve', 'oldgold:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'oldgold:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'oldgold:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'oldgold:view'), ('accountant', 'oldgold:export'),
  ('gold_officer', 'oldgold:view'), ('gold_officer', 'oldgold:create'), ('gold_officer', 'oldgold:edit'),
  ('cashier', 'oldgold:view'), ('cashier', 'oldgold:create'),
  ('salesperson', 'oldgold:view'), ('inventory_officer', 'oldgold:view');
