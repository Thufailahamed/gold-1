CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  next INTEGER NOT NULL DEFAULT 1
);
INSERT INTO counters (name, next) VALUES ('PO', 1), ('PINV', 1);
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  purity_id TEXT NOT NULL REFERENCES purities(id),
  gross_mg INTEGER NOT NULL,
  net_mg INTEGER NOT NULL,
  est_cost_cents INTEGER NOT NULL,
  notes TEXT
);
CREATE TABLE purchase_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_id TEXT REFERENCES purchase_orders(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  subtotal_cents INTEGER NOT NULL,
  charges_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_pinvoices_supplier ON purchase_invoices(supplier_id, created_at DESC);
CREATE INDEX idx_pinvoices_branch ON purchase_invoices(branch_id, created_at DESC);
CREATE TABLE purchase_invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  gross_mg INTEGER NOT NULL,
  net_mg INTEGER NOT NULL,
  purity_id TEXT NOT NULL REFERENCES purities(id),
  cost_cents INTEGER NOT NULL,
  making_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE purchase_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  ref_entity TEXT NOT NULL DEFAULT 'purchase_payment',
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO permissions (id, name) VALUES
  ('purchases:view', 'purchases:view'), ('purchases:create', 'purchases:create'),
  ('purchases:edit', 'purchases:edit'), ('purchases:cancel', 'purchases:cancel'),
  ('purchases:export', 'purchases:export');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'purchases:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'purchases:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'purchases:view'), ('accountant', 'purchases:export'),
  ('inventory_officer', 'purchases:view'), ('inventory_officer', 'purchases:create'),
  ('inventory_officer', 'purchases:edit'),
  ('cashier', 'purchases:view'), ('salesperson', 'purchases:view'),
  ('gold_officer', 'purchases:view');
