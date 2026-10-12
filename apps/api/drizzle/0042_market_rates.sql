-- 0042_market_rates.sql
-- Reference prices from the international market (spot metals, crypto) and
-- the USD→LKR rate they were converted at. These are quotes, not money the
-- shop holds, so they stay REAL in the source currency; nothing posts from
-- them. Written hourly by the cron and when the live page is opened, so the
-- board can show 24h change and a history chart (the free feed has none).
CREATE TABLE market_snapshots (
  id TEXT PRIMARY KEY,
  captured_at INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  price_usd REAL NOT NULL,
  usd_lkr REAL NOT NULL
);
CREATE INDEX idx_market_snapshots_symbol ON market_snapshots(symbol, captured_at DESC);
