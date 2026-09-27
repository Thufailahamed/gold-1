CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE purities (
  id TEXT PRIMARY KEY,
  karat TEXT NOT NULL UNIQUE,
  purity REAL NOT NULL,
  default_making_charge REAL NOT NULL DEFAULT 0,
  default_wastage_pct REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE gold_rates (
  id TEXT PRIMARY KEY,
  purity_id TEXT NOT NULL REFERENCES purities(id),
  rate_per_gram REAL NOT NULL,
  effective_from INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  UNIQUE (purity_id, effective_from)
);
CREATE INDEX idx_gold_rates_current ON gold_rates(purity_id, effective_from DESC);
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  nic TEXT UNIQUE,
  credit_limit REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  nic TEXT UNIQUE,
  credit_limit REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO permissions (id, name) VALUES ('masters:read', 'masters:read'), ('masters:write', 'masters:write');
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'masters:read'), ('admin', 'masters:write'),
  ('manager', 'masters:read'), ('manager', 'masters:write'),
  ('cashier', 'masters:read');
INSERT INTO purities (id, karat, purity, created_at) VALUES
  ('purity-24k', '24K', 1.0, 1759000000000),
  ('purity-22k', '22K', 0.916, 1759000000000),
  ('purity-21k', '21K', 0.875, 1759000000000),
  ('purity-18k', '18K', 0.75, 1759000000000);
INSERT INTO categories (id, name, code, created_at) VALUES
  ('cat-ring', 'Ring', 'RING', 1759000000000),
  ('cat-chain', 'Chain', 'CHAIN', 1759000000000),
  ('cat-bangle', 'Bangle', 'BANGLE', 1759000000000),
  ('cat-earring', 'Earring', 'EARRING', 1759000000000),
  ('cat-pendant', 'Pendant', 'PENDANT', 1759000000000),
  ('cat-necklace', 'Necklace', 'NECKLACE', 1759000000000);
