-- Align engine thresholds with the legacy per-module defaults they supersede,
-- so existing behavior is preserved and shops tighten via settings.
-- Legacy sources: melt_loss_approve_pct (2%), mfg_loss_approve_pct (3%),
-- gold_adjust_approve_mg (1000mg), return_approval_threshold (LKR 100,000 in
-- cents). Those legacy keys are no longer read; this migration carries their
-- effective defaults forward. New actions (rate changes, valuation overrides,
-- cancellations, adjustments, price overrides) stay strict (0) by default.
UPDATE settings SET value_json = '2' WHERE key = 'approval_threshold_MELT_DIFFERENCE';
UPDATE settings SET value_json = '3' WHERE key = 'approval_threshold_MFG_DIFFERENCE';
UPDATE settings SET value_json = '1000' WHERE key = 'approval_threshold_GOLD_STOCK_ADJUST';
UPDATE settings SET value_json = '10000000' WHERE key = 'approval_threshold_SALES_RETURN';
