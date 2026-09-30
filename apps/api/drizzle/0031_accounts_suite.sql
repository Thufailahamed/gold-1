-- 0031_accounts_suite.sql
-- Collecting customer dues, typed non-trading cash movements, and the ledger
-- accounts they post into. Additive only.

-- Accounts the new flows post into. System accounts: the shop cannot rename
-- them out from under the postings.
INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES
  ('3200', 'Owner''s Drawings',  'EQUITY',  1, 1, 'Cash or bank the owner takes out of the business'),
  ('4900', 'Other Income',       'REVENUE', 1, 1, 'Income that is not a jewellery sale (commission, scrap, rent received)'),
  ('6090', 'Cash Short & Over',  'EXPENSE', 1, 1, 'Till corrections: shortages debit, overages credit')
ON CONFLICT(code) DO NOTHING;

-- A receipt is money a customer pays against what they already owe. It is
-- its own document (not a sales_payments row) because sales_payments drives
-- the payments cross-foot, the day-close sales figure and refund splitting —
-- all of which are about money taken AT the sale.
CREATE TABLE customer_receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  receipt_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','bank','card')),
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  bank_account_id TEXT REFERENCES bank_accounts(id),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','VOID')),
  void_reason TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_rcpt_customer ON customer_receipts(customer_id, receipt_date);
CREATE INDEX idx_rcpt_branch   ON customer_receipts(branch_id, receipt_date);

-- Which invoices a receipt cleared, oldest first. Monthly receivables
-- outstanding subtracts these (for POSTED receipts only).
CREATE TABLE customer_receipt_allocations (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES customer_receipts(id),
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
);
CREATE INDEX idx_rcpt_alloc_invoice ON customer_receipt_allocations(invoice_id);
CREATE INDEX idx_rcpt_alloc_receipt ON customer_receipt_allocations(receipt_id);

-- Owner in/out, other income and till corrections. Each row owns exactly one
-- journal entry; the kind decides the counter account.
CREATE TABLE cash_entries (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  entry_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('OWNER_CAPITAL','OWNER_DRAWING','OTHER_INCOME','CASH_OVER','CASH_SHORT')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  bank_account_id TEXT REFERENCES bank_accounts(id),
  note TEXT NOT NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_cash_entries_branch ON cash_entries(branch_id, entry_date);

INSERT INTO counters (name, next) VALUES ('RCPT', 1), ('CSH', 1)
ON CONFLICT(name) DO NOTHING;
