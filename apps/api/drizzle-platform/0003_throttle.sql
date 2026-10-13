-- Public self-serve throttles (per IP + purpose). No personal data: keys are
-- opaque `purpose:ip` strings, rows are tiny and expire by window.
CREATE TABLE public_throttle (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
