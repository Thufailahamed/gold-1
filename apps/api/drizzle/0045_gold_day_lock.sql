-- 0045_gold_day_lock.sql
-- A closed day is closed for gold too.
--
-- The close freezes the branch's gold balance in its report, but gold-only
-- movements (melting, manufacturing, stock transfers) post no journal entry,
-- so the journal lock (0044) never saw them: a melt keyed after the close
-- landed inside the closed day. This aborts any gold_ledger row whose
-- shop-local date is closed at a branch it touches — its own branch, or
-- either end of a transfer ('branch:<id>' in source or destination).
--
-- The shop-local date uses the business_tz_offset_minutes setting (default
-- 330), the same expression as TZ_MODIFIER_SQL in services/busdate.ts.
CREATE TRIGGER trg_gold_day_lock
BEFORE INSERT ON gold_ledger
WHEN EXISTS (
  SELECT 1 FROM day_closings d
  WHERE d.status = 'CLOSED'
    AND d.close_date = date(NEW.occurred_at / 1000, 'unixepoch',
          (COALESCE((SELECT CAST(value_json AS INTEGER) FROM settings WHERE key = 'business_tz_offset_minutes' AND json_type(value_json) IN ('integer', 'real')), 330) || ' minutes'))
    AND (d.branch_id = NEW.branch_id
         OR 'branch:' || d.branch_id = NEW.source
         OR 'branch:' || d.branch_id = NEW.destination)
)
BEGIN
  SELECT RAISE(ABORT, 'DAY_CLOSED: the day is closed at a branch this gold movement touches');
END;
