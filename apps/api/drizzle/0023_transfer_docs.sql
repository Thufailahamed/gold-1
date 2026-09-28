-- 0023_transfer_docs.sql
-- Multi-item transfer documents with per-line states.
CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  from_branch_id TEXT NOT NULL REFERENCES branches(id),
  to_branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  reason TEXT,
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tr_status ON transfers(status);
CREATE INDEX idx_tr_branches ON transfers(from_branch_id, to_branch_id);

CREATE TABLE transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  barcode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_tl_transfer_product ON transfer_lines(transfer_id, product_id);
CREATE INDEX idx_tl_status ON transfer_lines(status);

INSERT INTO counters (name, next) VALUES ('TRF', 1);
