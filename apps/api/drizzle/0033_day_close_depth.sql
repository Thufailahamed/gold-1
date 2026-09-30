-- 0033_day_close_depth.sql
-- What the closing counted and what it did about a difference. Additive; a
-- close that sends none of the new fields behaves exactly as before.

-- The note-and-coin count behind actual_cents, e.g. {"5000":3,"1000":12}.
-- Kept so a shortage can be re-checked against the sheet, not just the total.
ALTER TABLE day_closings ADD COLUMN denominations_json TEXT;

-- The card terminal's own end-of-day total, against the card sales the ledger
-- recorded (1020 debits for the day). A difference is a sale keyed as cash
-- that went on the card, or the reverse — money that looks missing but is not.
ALTER TABLE day_closings ADD COLUMN card_expected_cents INTEGER;
ALTER TABLE day_closings ADD COLUMN card_actual_cents INTEGER;

-- The Cash Short & Over entry the close posted so the ledger drawer agrees
-- with the counted drawer. Without it, tomorrow's opening (read from the
-- ledger) carries today's shortage forward as if the money were still there.
ALTER TABLE day_closings ADD COLUMN correction_cents INTEGER NOT NULL DEFAULT 0;
