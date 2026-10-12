-- 0043_market_desk.sql
-- Rate desk tools on Live Rates. Pricing policy and import costs live in
-- settings (market.board_policy, market.import_costs, market.events); these
-- tables hold what is a list rather than a value.

-- Price watches. A rule fires once when its condition becomes true and
-- re-arms when it turns false again, so a price hovering at the line does
-- not repeat the same alert every check.
CREATE TABLE market_alerts (
  id TEXT PRIMARY KEY,
  -- PRICE_ABOVE | PRICE_BELOW: target is USD per quoted unit (symbol) or LKR per gram (karat)
  -- MOVE_PCT: absolute 24h change ≥ threshold %
  -- BOARD_GAP: |board − market| ≥ threshold % of market, per karat
  kind TEXT NOT NULL,
  symbol TEXT,
  purity_id TEXT REFERENCES purities(id),
  threshold REAL NOT NULL,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_tripped INTEGER NOT NULL DEFAULT 0,
  last_value REAL,
  last_checked_at INTEGER,
  last_fired_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_market_alerts_active ON market_alerts(is_active);

CREATE TABLE market_alert_events (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES market_alerts(id),
  fired_at INTEGER NOT NULL,
  value REAL NOT NULL,
  message TEXT NOT NULL,
  seen_at INTEGER,
  seen_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_market_alert_events_fired ON market_alert_events(fired_at DESC);

-- Rates seen at other shops (Pettah, the shop next door), typed in by staff;
-- there is no public feed for local retail rates.
CREATE TABLE competitor_rates (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  area TEXT,
  purity_id TEXT NOT NULL REFERENCES purities(id),
  -- SELL: what they charge per gram; BUY: what they pay for old gold
  side TEXT NOT NULL DEFAULT 'SELL',
  rate_cents_per_g INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  notes TEXT,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_competitor_rates_seen ON competitor_rates(observed_at DESC);
CREATE INDEX idx_competitor_rates_purity ON competitor_rates(purity_id, side, observed_at DESC);
