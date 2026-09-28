-- 0019_expenses.sql
-- Expense categories each owning a ledger account, and expense entries with
-- branch, payment account, threshold-driven approval and a receipt.

CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  account_code TEXT NOT NULL UNIQUE REFERENCES chart_of_accounts(code),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

-- status is PENDING_APPROVAL | POSTED | REJECTED. There is no VOID: a
-- rejected expense stays visible with its reason, per the append-only rule.
-- There is no DRAFT either — the row and, when no approval is required, the
-- journal entry land in one batch.
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  incurred_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  vendor TEXT,
  description TEXT NOT NULL,
  -- The RESOLVED account: 1000 for cash, or the bank account's own code.
  -- Stored rather than recomputed so the record still says where the money
  -- came from after a bank account is renamed.
  payment_account_code TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id),
  status TEXT NOT NULL DEFAULT 'POSTED',
  receipt_key TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER,
  rejection_reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_exp_date   ON expenses(branch_id, incurred_on);
CREATE INDEX idx_exp_status ON expenses(status, incurred_on);
CREATE INDEX idx_exp_cat    ON expenses(category_id, incurred_on);

INSERT INTO counters (name, next) VALUES ('EXP', 1);

-- Nine categories against the accounts the ledger core already created, so
-- the shop has a usable set on day one and no account sits empty and
-- unexplained.
INSERT INTO expense_categories (id, name, description, account_code, is_active, created_at, created_by) VALUES
  ('exp-rent',      'Rent & Rates',         'Shop rent, rates and common service charges', '6000', 1, 1759000000000, 'admin-1'),
  ('exp-utilities', 'Utilities',             'Electricity, water, gas, internet',           '6010', 1, 1759000000000, 'admin-1'),
  ('exp-salaries',  'Salaries & Wages',      'Staff wages, bonuses and EPF',               '6020', 1, 1759000000000, 'admin-1'),
  ('exp-repairs',   'Repairs & Maintenance', 'Tools, machinery, servicing and spares',      '6030', 1, 1759000000000, 'admin-1'),
  ('exp-transport', 'Transport & Delivery',  'Fuel, delivery and staff transport',          '6040', 1, 1759000000000, 'admin-1'),
  ('exp-marketing', 'Marketing & Advertising','Promotion, signage and advertising',           '6050', 1, 1759000000000, 'admin-1'),
  ('exp-bankfees',  'Bank & Card Charges',   'Bank fees, card processing and interest',    '6060', 1, 1759000000000, 'admin-1'),
  ('exp-office',    'Office & Consumables',  'Stationery and consumables',                  '6070', 1, 1759000000000, 'admin-1'),
  ('exp-other',     'Other Expenses',        'Anything the categories above do not cover',  '6080', 1, 1759000000000, 'admin-1');

-- Both gates are configuration, not code. 0 means "gate everything".
INSERT INTO settings (key, value_json, type) VALUES
  ('expense_approval_threshold_cents',  '500000',  'number'),
  ('expense_receipt_required_cents',   '1000000', 'number')
ON CONFLICT(key) DO NOTHING;
