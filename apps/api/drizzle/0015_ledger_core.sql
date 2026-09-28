-- 0015_ledger_core.sql
-- The journal becomes header + lines. The flat table is renamed in place so
-- its rows survive; 0016 groups them into headers.

ALTER TABLE journal_entries RENAME TO journal_lines;
ALTER TABLE journal_lines ADD COLUMN entry_id TEXT;
ALTER TABLE journal_lines ADD COLUMN line_no INTEGER;

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  memo TEXT,
  ref_entity TEXT,
  ref_id TEXT,
  ref_no TEXT,
  source_module TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'POSTED',
  reverses_entry_id TEXT REFERENCES journal_entries(id),
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_je_date     ON journal_entries(entry_date, branch_id);
CREATE INDEX idx_je_ref      ON journal_entries(ref_entity, ref_id);
CREATE INDEX idx_je_module   ON journal_entries(source_module, entry_date);
CREATE INDEX idx_je_status   ON journal_entries(status);
CREATE INDEX idx_je_reverses ON journal_entries(reverses_entry_id);

CREATE INDEX idx_jl_entry   ON journal_lines(entry_id, line_no);
CREATE INDEX idx_jl_account ON journal_lines(account_code);
CREATE INDEX idx_jl_party   ON journal_lines(party_type, party_id);

ALTER TABLE chart_of_accounts ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chart_of_accounts ADD COLUMN description TEXT;

-- Accounts the ledger posts into cannot be repurposed by the shop. The shop
-- configures *additional* accounts, not these.
UPDATE chart_of_accounts SET is_system = 1 WHERE code IN
  ('1000','1010','1100','1200','2000','2100','3000','3100','4000','5000');

-- 6000 is renamed rather than left as a generic bucket: it has zero entries,
-- and spec 2.3 gives every expense category its own account.
UPDATE chart_of_accounts
SET name = 'Rent & Rates', description = 'Shop rent and rates'
WHERE code = '6000';

INSERT INTO chart_of_accounts (code, name, type, is_system, description) VALUES
  ('1020', 'Card Clearing',           'ASSET',     1, 'Card sales awaiting settlement'),
  ('2200', 'Other Payables',          'LIABILITY', 1, 'Accrued costs not yet paid'),
  ('5100', 'Gold Melting Loss',       'EXPENSE',   1, 'Fine gold lost in melting'),
  ('5200', 'Gold Manufacturing Loss', 'EXPENSE',   1, 'Fine gold lost in manufacturing'),
  ('5300', 'Gold Adjustment Loss',    'EXPENSE',   1, 'Net gold shrinkage from stock counts');

INSERT INTO chart_of_accounts (code, name, type, is_system, description) VALUES
  ('6010', 'Utilities',              'EXPENSE', 0, 'Electricity, water, gas'),
  ('6020', 'Salaries & Wages',       'EXPENSE', 0, 'Staff wages and bonuses'),
  ('6030', 'Repairs & Maintenance',  'EXPENSE', 0, 'Tools, machinery, repairs'),
  ('6040', 'Transport & Delivery',   'EXPENSE', 0, 'Transport of goods and staff'),
  ('6050', 'Marketing & Advertising', 'EXPENSE', 0, 'Promotion and advertising'),
  ('6060', 'Bank & Card Charges',    'EXPENSE', 0, 'Bank fees, card processing, interest'),
  ('6070', 'Office & Consumables',   'EXPENSE', 0, 'Stationery and consumables'),
  ('6080', 'Other Expenses',         'EXPENSE', 0, 'Anything not covered above');

-- The document that owns an entry, so a correction reverses *that* entry
-- rather than guessing by ref_entity/ref_id plus created_at.
ALTER TABLE sales_invoices     ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE sales_returns      ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE purchase_invoices  ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE old_gold_purchases ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);

-- Book-cost chain: what the shop paid -> melt lot -> finished product.
ALTER TABLE melting_batches ADD COLUMN input_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE melting_outputs ADD COLUMN cost_cents      INTEGER NOT NULL DEFAULT 0;

INSERT INTO counters (name, next) VALUES ('JE', 1), ('GADJ', 1);

-- Shop-local business date. UTC+5:30; overridable in the settings table.
INSERT INTO settings (key, value_json, type)
VALUES ('business_tz_offset_minutes', '330', 'number')
ON CONFLICT(key) DO NOTHING;
