-- 0018_cash_bank.sql
-- Configurable bank accounts, card settlement out of Card Clearing, two-entry
-- branch cash transfers, and recorded bank statement reconciliation.

CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  account_code TEXT NOT NULL UNIQUE REFERENCES chart_of_accounts(code),
  branch_id TEXT REFERENCES branches(id),
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  opened_on TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE card_settlements (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  settled_on TEXT NOT NULL,
  gross_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL,
  acquirer_ref TEXT,
  note TEXT,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

-- A transfer is never cancelled. One that turns out to be wrong is a second,
-- opposite transfer, per the append-only rule.
CREATE TABLE cash_transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  from_branch_id TEXT NOT NULL REFERENCES branches(id),
  to_branch_id TEXT NOT NULL REFERENCES branches(id),
  amount_cents INTEGER NOT NULL,
  sent_on TEXT NOT NULL,
  received_on TEXT,
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT',
  reason TEXT NOT NULL,
  from_entry_id TEXT REFERENCES journal_entries(id),
  to_entry_id   TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE bank_reconciliations (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id),
  statement_date TEXT NOT NULL,
  statement_balance_cents INTEGER NOT NULL,
  ledger_balance_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_cs_account ON card_settlements(bank_account_id, settled_on);
CREATE INDEX idx_ct_status   ON cash_transfers(status, sent_on);
CREATE INDEX idx_br_account  ON bank_reconciliations(bank_account_id, statement_date DESC);

INSERT INTO counters (name, next) VALUES ('SETL', 1), ('XFER', 1);
