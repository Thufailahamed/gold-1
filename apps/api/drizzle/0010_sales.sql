INSERT INTO counters (name, next) VALUES ('SINV', 1), ('SRET', 1);
CREATE TABLE sales_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  salesperson_id TEXT REFERENCES users(id),
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_sinvoices_branch ON sales_invoices(branch_id, created_at DESC);
CREATE INDEX idx_sinvoices_customer ON sales_invoices(customer_id, created_at DESC);
CREATE TABLE sales_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  price_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL
);
CREATE TABLE sales_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  ref_entity TEXT NOT NULL DEFAULT 'sale_payment',
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE sales_returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  refund_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  exchange_sale_id TEXT REFERENCES sales_invoices(id),
  status TEXT NOT NULL DEFAULT 'COMPLETE',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE sales_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sales_returns(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  invoice_item_id TEXT NOT NULL REFERENCES sales_items(id)
);
CREATE TABLE gold_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  direction TEXT NOT NULL,
  fine_mg INTEGER NOT NULL,
  purity_permille INTEGER NOT NULL,
  ref_entity TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_gold_product ON gold_movements(product_id, created_at DESC);
CREATE INDEX idx_gold_ref ON gold_movements(ref_entity, ref_id);
INSERT INTO permissions (id, name) VALUES
  ('sales:view', 'sales:view'), ('sales:create', 'sales:create'),
  ('sales:edit', 'sales:edit'), ('sales:cancel', 'sales:cancel'),
  ('sales:export', 'sales:export'), ('sales:approve', 'sales:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'sales:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'sales:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'sales:view'), ('accountant', 'sales:export'),
  ('cashier', 'sales:view'), ('cashier', 'sales:create'),
  ('salesperson', 'sales:view'), ('salesperson', 'sales:create'),
  ('gold_officer', 'sales:view'), ('inventory_officer', 'sales:view');
