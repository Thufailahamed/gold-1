CREATE TABLE chart_of_accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT REFERENCES branches(id)
);
INSERT INTO chart_of_accounts (code, name, type) VALUES
  ('1000', 'Cash on Hand', 'ASSET'),
  ('1010', 'Bank', 'ASSET'),
  ('1100', 'Gold Inventory', 'ASSET'),
  ('1200', 'Customer Receivables', 'ASSET'),
  ('2000', 'Supplier Payables', 'LIABILITY'),
  ('2100', 'Tax Payable', 'LIABILITY'),
  ('3000', 'Owner''s Equity', 'EQUITY'),
  ('3100', 'Opening Balances', 'EQUITY'),
  ('4000', 'Sales Revenue', 'REVENUE'),
  ('5000', 'Cost of Goods Sold', 'EXPENSE'),
  ('6000', 'Operating Expenses', 'EXPENSE');
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  party_type TEXT,
  party_id TEXT,
  ref_entity TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  memo TEXT,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_journal_account ON journal_entries(account_code, created_at DESC);
CREATE INDEX idx_journal_party ON journal_entries(party_type, party_id, created_at DESC);
CREATE INDEX idx_journal_ref ON journal_entries(ref_entity, ref_id);
ALTER TABLE suppliers ADD COLUMN code TEXT;
ALTER TABLE suppliers ADD COLUMN notes TEXT;
ALTER TABLE customers ADD COLUMN code TEXT;
ALTER TABLE customers ADD COLUMN notes TEXT;
UPDATE suppliers SET code = 'SUP-' || SUBSTR(UPPER(HEX(RANDOMBLOB(3))), 1, 6) WHERE code IS NULL;
UPDATE customers SET code = 'CUS-' || SUBSTR(UPPER(HEX(RANDOMBLOB(3))), 1, 6) WHERE code IS NULL;
CREATE UNIQUE INDEX idx_suppliers_code ON suppliers(code);
CREATE UNIQUE INDEX idx_customers_code ON customers(code);
INSERT INTO permissions (id, name) VALUES ('accounts:view', 'accounts:view'), ('accounts:manage', 'accounts:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id IN ('accounts:view', 'accounts:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id IN ('accounts:view', 'accounts:manage');
INSERT INTO role_permissions (role_id, permission_id) VALUES ('accountant', 'accounts:manage'), ('cashier', 'accounts:view');
