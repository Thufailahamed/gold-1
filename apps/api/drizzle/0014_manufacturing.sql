INSERT INTO counters (name, next) VALUES ('MO', 1);
CREATE TABLE manufacturing_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  design TEXT NOT NULL,
  description TEXT,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  labour_cents INTEGER NOT NULL DEFAULT 0,
  making_cents INTEGER NOT NULL DEFAULT 0,
  stone_cost_cents INTEGER NOT NULL DEFAULT 0,
  loss_mg INTEGER NOT NULL DEFAULT 0,
  loss_reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE manufacturing_materials (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES manufacturing_orders(id),
  lot_batch_id TEXT NOT NULL REFERENCES melting_batches(id),
  lot_number TEXT NOT NULL,
  fine_mg INTEGER NOT NULL
);
CREATE INDEX idx_mfgmat_lot ON manufacturing_materials(lot_batch_id, lot_number);
CREATE TABLE manufacturing_outputs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES manufacturing_orders(id),
  product_id TEXT REFERENCES products(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  metal_type_id TEXT NOT NULL REFERENCES metal_types(id),
  purity_id TEXT NOT NULL REFERENCES purities(id),
  name TEXT NOT NULL,
  gross_mg INTEGER NOT NULL,
  stone_mg INTEGER NOT NULL DEFAULT 0,
  net_mg INTEGER NOT NULL,
  making_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  location TEXT
);
INSERT INTO permissions (id, name) VALUES
  ('mfg:view', 'mfg:view'), ('mfg:create', 'mfg:create'),
  ('mfg:edit', 'mfg:edit'), ('mfg:approve', 'mfg:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'mfg:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'mfg:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'mfg:view'),
  ('gold_officer', 'mfg:view'),
  ('inventory_officer', 'mfg:view'),
  ('manufacturing_staff', 'mfg:view'),
  ('manufacturing_staff', 'mfg:create'),
  ('manufacturing_staff', 'mfg:edit');
