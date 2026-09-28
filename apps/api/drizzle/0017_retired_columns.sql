-- 0017_retired_columns.sql
-- Drops everything the new journal shape made redundant, and retires the
-- party opening-balance columns. Runs after 0016 because the backfill still
-- reads the vestigial columns to group the old rows.
--
-- Index drops come first: SQLite refuses to DROP COLUMN while an index
-- references it, and ALTER TABLE RENAME carried 0008's indexes over to the
-- renamed table.

DROP INDEX IF EXISTS idx_journal_account;
DROP INDEX IF EXISTS idx_journal_party;
DROP INDEX IF EXISTS idx_journal_ref;

-- These now live on the header. The line's author is always the entry's
-- author, so created_by is redundant there too.
ALTER TABLE journal_lines DROP COLUMN ref_entity;
ALTER TABLE journal_lines DROP COLUMN ref_id;
ALTER TABLE journal_lines DROP COLUMN branch_id;
ALTER TABLE journal_lines DROP COLUMN created_at;
ALTER TABLE journal_lines DROP COLUMN created_by;

-- Opening balances are now journal entries against 3100 (see 0016). The
-- column was a second source of truth for a number the ledger already held,
-- and the two could disagree.
ALTER TABLE customers DROP COLUMN opening_balance_cents;
ALTER TABLE suppliers DROP COLUMN opening_balance_cents;
