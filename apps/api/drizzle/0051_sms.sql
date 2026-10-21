-- 0051_sms.sql
-- Credit reminder SMS through the SMSlenz gateway. One settings row per shop
-- holds the gateway credentials, and a log keeps every message.
CREATE TABLE IF NOT EXISTS sms_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  sender_id TEXT NOT NULL DEFAULT '',
  shop_name TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT '',
  auto_enabled INTEGER NOT NULL DEFAULT 0,
  auto_after_days INTEGER NOT NULL DEFAULT 7,
  repeat_days INTEGER NOT NULL DEFAULT 7,
  send_hour INTEGER NOT NULL DEFAULT 10,
  min_amount_cents INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sms_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MANUAL','AUTO','TEST')),
  status TEXT NOT NULL CHECK (status IN ('SENT','FAILED')),
  error TEXT,
  pages INTEGER,
  provider_ref TEXT,
  amount_cents INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sms_log_customer ON sms_log(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_log_created ON sms_log(created_at DESC);
