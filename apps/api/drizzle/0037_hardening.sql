-- 0037_hardening.sql
-- Request-level safety the audit left open.
--
-- 1. Login throttling. One row per throttle key ("email:<addr>" or
--    "ip:<addr>"): failures inside the current window, and a lock that
--    refuses further attempts until it lapses. A successful login clears the
--    email key. Rows are tiny and self-expiring in effect (a lapsed window is
--    reset on the next failure), so no housekeeping job is required.
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);

-- 2. Idempotent writes. The table existed since 0001 but held only the key.
--    A client that retries a mutation with the same Idempotency-Key header
--    now gets the first response replayed instead of a second sale, payment
--    or gold movement. Keys are scoped to the user and the route so one
--    person's key can never replay another's response.
ALTER TABLE idempotency_keys ADD COLUMN user_id TEXT;
ALTER TABLE idempotency_keys ADD COLUMN method TEXT;
ALTER TABLE idempotency_keys ADD COLUMN path TEXT;
ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT;
ALTER TABLE idempotency_keys ADD COLUMN status INTEGER;
ALTER TABLE idempotency_keys ADD COLUMN response_json TEXT;
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);
