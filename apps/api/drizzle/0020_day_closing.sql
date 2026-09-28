-- 0020_day_closing.sql
-- A closing record per branch and day, and an append-only trail of re-opens.

-- day_reopens is a separate table rather than columns on day_closings so a
-- day reopened twice has two records, not one overwritten reason. The close
-- row is never deleted or rewritten: its snapshot, actual count and
-- difference are the record of what the shop believed at the time.
CREATE TABLE day_closings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  close_date TEXT NOT NULL,
  opening_cents INTEGER NOT NULL,
  cash_in_cents INTEGER NOT NULL,
  cash_out_cents INTEGER NOT NULL,
  expected_cents INTEGER NOT NULL,
  actual_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  difference_reason TEXT,
  -- The whole rendered screen, frozen. Re-readable after the code around it
  -- changes, so a report from six months ago is a record and not a guess.
  report_json TEXT NOT NULL,
  checks_passed INTEGER NOT NULL,
  -- Only 'CLOSED' blocks a posting. A re-opened day can be posted to again.
  status TEXT NOT NULL DEFAULT 'CLOSED',
  closed_by TEXT REFERENCES users(id),
  closed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_dc_branch_date ON day_closings(branch_id, close_date);
CREATE INDEX idx_dc_date ON day_closings(close_date);

CREATE TABLE day_reopens (
  id TEXT PRIMARY KEY,
  closing_id TEXT NOT NULL REFERENCES day_closings(id),
  reason TEXT NOT NULL,
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_dr_closing ON day_reopens(closing_id);
