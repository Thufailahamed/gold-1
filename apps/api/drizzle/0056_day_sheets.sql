-- 0056_day_sheets.sql
-- The shop's handwritten day sheet: one per branch per business day. A photo
-- of the paper sheet is read by AI into rows, a person corrects them, and the
-- saved rows are matched against what the system recorded for that day.
-- The rows hold what the PAPER says; the system's side is always derived live
-- from the books, so a fix in the books shows up without re-saving the sheet.
CREATE TABLE IF NOT EXISTS day_sheets (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  sheet_date TEXT NOT NULL,
  -- DRAFT: read or typed, not yet checked. VERIFIED: every row agrees (or was
  -- accepted). ISSUES: at least one mismatch or missing entry is open.
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','VERIFIED','ISSUES')),
  image_keys TEXT NOT NULL DEFAULT '[]',
  ai_model TEXT,
  ai_warnings_json TEXT NOT NULL DEFAULT '[]',
  matched_count INTEGER NOT NULL DEFAULT 0,
  mismatch_count INTEGER NOT NULL DEFAULT 0,
  missing_in_system_count INTEGER NOT NULL DEFAULT 0,
  missing_on_sheet_count INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id),
  UNIQUE (branch_id, sheet_date)
);
CREATE INDEX IF NOT EXISTS idx_day_sheets_status ON day_sheets(status, sheet_date DESC);

CREATE TABLE IF NOT EXISTS day_sheet_rows (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES day_sheets(id),
  line_no INTEGER NOT NULL,
  ref_no TEXT,
  name TEXT,
  phone TEXT,
  details TEXT,
  gold_text TEXT,
  gold_mg INTEGER,
  received_cents INTEGER,
  received_method TEXT,
  given_cents INTEGER,
  given_method TEXT,
  old_gold_cents INTEGER,
  -- A person's explicit pairing with a system document ("customer_receipt:<id>"),
  -- set when a row is added to the system from the sheet or linked by hand.
  linked_ref TEXT,
  -- A difference a person looked at and accepted, with why.
  accepted INTEGER NOT NULL DEFAULT 0,
  accept_note TEXT,
  -- From the last check: MATCHED, MISMATCH, MISSING_IN_SYSTEM, ACCEPTED, EMPTY.
  match_status TEXT,
  match_ref TEXT,
  issues_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_day_sheet_rows_sheet ON day_sheet_rows(sheet_id, line_no);

-- System documents a person confirmed belong off the paper sheet (a bank
-- transfer the counter never sees, say), so they stop being reported missing.
CREATE TABLE IF NOT EXISTS day_sheet_ignores (
  sheet_id TEXT NOT NULL REFERENCES day_sheets(id),
  ref TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  PRIMARY KEY (sheet_id, ref)
);
