-- 0040_ai_features.sql
-- Daily brief: one row per shop-local day. The findings are computed from the
-- ledger by code; the model only words them. Stored so the dashboard shows
-- the same brief to everyone and a refresh replaces it rather than stacking.

CREATE TABLE IF NOT EXISTS ai_briefs (
  brief_date TEXT PRIMARY KEY,
  findings_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  -- the model that worded it, or 'rules' when the model was unavailable or its
  -- wording quoted a figure that is not in the findings
  model TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('cron', 'manual')),
  generated_at INTEGER NOT NULL
);

INSERT INTO settings (key, value_json, type) VALUES
  ('brief_enabled', 'true', 'boolean'),
  -- shop-local hour (0-23) after which the day's brief is written
  ('brief_hour', '21', 'number')
ON CONFLICT(key) DO NOTHING;
