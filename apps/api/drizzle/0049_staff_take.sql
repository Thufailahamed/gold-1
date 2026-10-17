-- 0049_staff_take.sql
-- An employee (or the owner) taking cash from the drawer is a named movement:
-- STAFF_TAKE posts to 1250 Staff Advances, and cash entries now record who
-- took the money. SQLite cannot widen a CHECK, so the table is rebuilt.
INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES
  ('1250', 'Staff Advances', 'ASSET', 1, 1, 'Cash taken from the drawer by employees, to be recovered from pay')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE cash_entries_new (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  entry_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('OWNER_CAPITAL','OWNER_DRAWING','STAFF_TAKE','OTHER_INCOME','CASH_OVER','CASH_SHORT')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  bank_account_id TEXT REFERENCES bank_accounts(id),
  note TEXT NOT NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  person TEXT
);
INSERT INTO cash_entries_new (id, number, branch_id, entry_date, kind, amount_cents, account_code, bank_account_id, note, journal_entry_id, created_at, created_by)
  SELECT id, number, branch_id, entry_date, kind, amount_cents, account_code, bank_account_id, note, journal_entry_id, created_at, created_by FROM cash_entries;
DROP TABLE cash_entries;
ALTER TABLE cash_entries_new RENAME TO cash_entries;
CREATE INDEX idx_cash_entries_branch ON cash_entries(branch_id, entry_date);
