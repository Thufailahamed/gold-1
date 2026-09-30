-- 0032_accounting_completion.sql
-- Output VAT on sales, tax remittance, financial-year close, and the counter
-- the new documents number from. Additive only; every default leaves existing
-- behaviour unchanged (tax rate 0 = no tax line on any document).

-- Tax is stored per line AND per document. The line figure is what a return
-- refunds, so a partial return gives back exactly the tax that item carried,
-- never a re-derived one at today's rate.
ALTER TABLE sales_invoices ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_items    ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_returns  ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;
-- The rate the invoice was taxed at, in basis points (1800 = 18%). Snapshotted
-- so the printed invoice still states the rate after the setting changes.
ALTER TABLE sales_invoices ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0;

UPDATE chart_of_accounts
SET is_system = 1, description = 'Output tax (VAT) collected on sales, owed to the revenue authority'
WHERE code = '2100';

-- Paying the tax authority what 2100 holds. DR 2100 / CR the money account.
CREATE TABLE tax_payments (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  paid_on TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank')),
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  bank_account_id TEXT REFERENCES bank_accounts(id),
  reference TEXT,
  note TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_tax_payments_date ON tax_payments(paid_on, branch_id);

-- A closed financial year. Closing posts nothing: retained earnings are
-- derived (profit of every entry dated on or before the last year end), so no
-- P&L reader ever has to learn to skip a closing entry. What a close DOES do
-- is lock every posting dated on or before year_end and freeze the year's
-- statements into report_json.
CREATE TABLE fiscal_closes (
  id TEXT PRIMARY KEY,
  year_start TEXT NOT NULL,
  year_end TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('CLOSED','REOPENED')),
  net_profit_cents INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  closed_at INTEGER NOT NULL,
  closed_by TEXT REFERENCES users(id),
  reopened_at INTEGER,
  reopened_by TEXT REFERENCES users(id),
  reopen_approved_by TEXT REFERENCES users(id),
  reopen_reason TEXT
);
CREATE INDEX idx_fiscal_closes_status ON fiscal_closes(status, year_end);

INSERT INTO counters (name, next) VALUES ('TAXP', 1)
ON CONFLICT(name) DO NOTHING;

INSERT INTO settings (key, value_json, type) VALUES
  ('sales_tax_rate_bp', '0', 'number'),
  ('sales_tax_label', '"VAT"', 'string'),
  ('sales_tax_reg_no', '""', 'string'),
  -- Sri Lanka's year of assessment runs April to March.
  ('fiscal_year_start_month', '4', 'number')
ON CONFLICT(key) DO NOTHING;
