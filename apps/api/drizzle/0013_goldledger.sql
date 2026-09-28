CREATE TABLE gold_ledger (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  branch_id TEXT REFERENCES branches(id),
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  type TEXT NOT NULL,
  weight_mg INTEGER NOT NULL,
  permille INTEGER NOT NULL,
  fine_mg INTEGER NOT NULL,
  ref_entity TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  product_id TEXT REFERENCES products(id),
  old_gold_id TEXT REFERENCES old_gold_items(id),
  user_id TEXT REFERENCES users(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_goldledger_branch ON gold_ledger(branch_id, occurred_at DESC);
CREATE INDEX idx_goldledger_ref ON gold_ledger(ref_entity, ref_id);
CREATE INDEX idx_goldledger_product ON gold_ledger(product_id, occurred_at DESC);
CREATE INDEX idx_goldledger_oldgold ON gold_ledger(old_gold_id, occurred_at DESC);
CREATE TABLE melting_batches (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  input_fine_mg INTEGER NOT NULL DEFAULT 0,
  output_fine_mg INTEGER NOT NULL DEFAULT 0,
  waste_mg INTEGER NOT NULL DEFAULT 0,
  loss_mg INTEGER NOT NULL DEFAULT 0,
  recovery_mg INTEGER NOT NULL DEFAULT 0,
  difference_reason TEXT,
  approved_by TEXT REFERENCES users(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE melting_inputs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES melting_batches(id),
  old_gold_id TEXT NOT NULL UNIQUE REFERENCES old_gold_items(id),
  gross_mg INTEGER NOT NULL,
  net_mg INTEGER NOT NULL,
  fine_mg INTEGER NOT NULL
);
CREATE TABLE melting_outputs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES melting_batches(id),
  lot_number TEXT NOT NULL UNIQUE,
  weight_mg INTEGER NOT NULL,
  permille INTEGER NOT NULL,
  fine_mg INTEGER NOT NULL,
  output_type TEXT NOT NULL DEFAULT 'grain'
);
INSERT INTO counters (name, next) VALUES ('MELT', 1);
INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by)
SELECT
  'bf-' || m.id, m.created_at, m.branch_id,
  CASE WHEN m.direction = 'OUT' THEN 'branch:' || COALESCE(m.branch_id, '') ELSE 'customer:unknown' END,
  CASE WHEN m.direction = 'OUT' THEN 'customer:unknown' ELSE 'branch:' || COALESCE(m.branch_id, '') END,
  CASE m.ref_entity
    WHEN 'sale_invoice' THEN 'SALE'
    WHEN 'sale_return' THEN 'RETURN'
    WHEN 'old_gold_purchase' THEN 'OLD_GOLD_PURCHASE'
    ELSE 'ADJUSTMENT'
  END,
  COALESCE(p.net_mg, o.net_mg, m.fine_mg),
  m.purity_permille,
  m.fine_mg,
  m.ref_entity, m.ref_id, m.product_id, m.old_gold_id, m.created_by,
  'backfill from gold_movements',
  m.created_at, m.created_by
FROM gold_movements m
LEFT JOIN products p ON p.id = m.product_id
LEFT JOIN old_gold_items o ON o.id = m.old_gold_id;
INSERT INTO permissions (id, name) VALUES ('gold:view', 'gold:view'), ('gold:manage', 'gold:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'gold:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'gold:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'gold:view'),
  ('gold_officer', 'gold:view'), ('gold_officer', 'gold:manage'),
  ('cashier', 'gold:view');
