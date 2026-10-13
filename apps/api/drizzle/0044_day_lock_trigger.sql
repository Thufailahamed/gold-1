-- 0044_day_lock_trigger.sql
-- The day lock, enforced by the database itself.
--
-- buildEntryStmts already refuses a posting dated on a closed day, but it
-- reads day_closings BEFORE its batch runs. A sale saved in the same instant
-- as the close could pass that read, then commit after the close — a posting
-- inside a closed day that the frozen report never saw, and tomorrow's
-- opening cash silently off by it. The trigger runs inside the writing
-- transaction, so whichever batch commits second loses.
--
-- The close's own Cash Short & Over correction is inserted in the same batch
-- BEFORE the close row turns CLOSED, so it passes.
CREATE TRIGGER trg_journal_day_lock
BEFORE INSERT ON journal_entries
WHEN NEW.branch_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM day_closings
    WHERE branch_id = NEW.branch_id AND close_date = NEW.entry_date AND status = 'CLOSED'
  )
BEGIN
  SELECT RAISE(ABORT, 'DAY_CLOSED: the day is closed at this branch');
END;
