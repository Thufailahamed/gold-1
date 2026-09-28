-- 0022_stock_count.sql
-- Count sessions with frozen snapshots and append-only scan logs.
CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  scope TEXT NOT NULL,
  scope_ref TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  expected_json TEXT NOT NULL,
  result_json TEXT,
  opened_by TEXT REFERENCES users(id),
  closed_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_sc_open_scope ON stock_counts(branch_id, scope, COALESCE(scope_ref, '')) WHERE status = 'OPEN';
CREATE INDEX idx_sc_status ON stock_counts(status);

CREATE TABLE count_scans (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES stock_counts(id),
  barcode TEXT NOT NULL,
  product_id TEXT REFERENCES products(id),
  flag TEXT NOT NULL DEFAULT 'OK',
  scanned_by TEXT REFERENCES users(id),
  scanned_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cs_count ON count_scans(count_id);
