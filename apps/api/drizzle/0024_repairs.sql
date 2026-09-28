-- 0024_repairs.sql
-- Customer repair jobs with append-only event trail.
CREATE TABLE repairs (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  item_desc TEXT NOT NULL,
  weight_mg INTEGER NOT NULL,
  condition_in TEXT NOT NULL,
  condition_out TEXT,
  repair_type TEXT NOT NULL,
  estimate_cents INTEGER NOT NULL,
  actual_cents INTEGER,
  technician_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rep_status ON repairs(status);
CREATE INDEX idx_rep_branch ON repairs(branch_id);
CREATE INDEX idx_rep_customer ON repairs(customer_id);

CREATE TABLE repair_events (
  id TEXT PRIMARY KEY,
  repair_id TEXT NOT NULL REFERENCES repairs(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_re_repair ON repair_events(repair_id);

INSERT INTO counters (name, next) VALUES ('RPR', 1);
