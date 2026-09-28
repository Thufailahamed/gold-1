-- 0021_month_snapshots.sql
-- Report-only monthly freeze. No lock: a snapshot is a reading, not a gate.
CREATE TABLE month_snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id),
  month TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_ms_branch_month ON month_snapshots(COALESCE(branch_id, ''), month);
CREATE INDEX idx_ms_month ON month_snapshots(month);
