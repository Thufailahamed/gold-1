CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  requester_id TEXT NOT NULL REFERENCES users(id),
  approver_id TEXT REFERENCES users(id),
  old_value_json TEXT NOT NULL DEFAULT '{}',
  new_value_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_action ON approvals(action);
CREATE INDEX idx_approvals_branch ON approvals(branch_id);
CREATE INDEX idx_approvals_requester ON approvals(requester_id);
-- Approval engine configuration. Thresholds, TTLs and approver permissions are
-- business rules: configuration, never code. A null/empty threshold disables
-- the async path (immediate execution, still audit-logged); a zero threshold
-- means any positive metric requires approval (used by always-require actions,
-- whose call sites pass metric 1).
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_default_ttl_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_SALES_DISCOUNT', '10', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_SALES_DISCOUNT_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_SALES_DISCOUNT', '"sales:approve"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_PRICE_OVERRIDE', '10', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_PRICE_OVERRIDE_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_PRICE_OVERRIDE', '"sales:approve"', 'string');
-- Gold-rate creation lives under masters:create (masters has no approve action),
-- so the closest manage-level perm, gold:manage, is the approver default.
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_GOLD_RATE_CHANGE', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_GOLD_RATE_CHANGE_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_GOLD_RATE_CHANGE', '"gold:manage"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_GOLD_STOCK_ADJUST', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_GOLD_STOCK_ADJUST_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_GOLD_STOCK_ADJUST', '"gold:manage"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_INVENTORY_ADJUST', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_INVENTORY_ADJUST_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_INVENTORY_ADJUST', '"products:cancel"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_OLDGOLD_VALUATION', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_OLDGOLD_VALUATION_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_OLDGOLD_VALUATION', '"oldgold:approve"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_MELT_DIFFERENCE', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_MELT_DIFFERENCE_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_MELT_DIFFERENCE', '"gold:manage"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_MFG_DIFFERENCE', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_MFG_DIFFERENCE_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_MFG_DIFFERENCE', '"mfg:approve"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_SALES_CANCEL', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_SALES_CANCEL_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_SALES_CANCEL', '"sales:cancel"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_PURCHASE_CANCEL', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_PURCHASE_CANCEL_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_PURCHASE_CANCEL', '"purchases:cancel"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_SALES_RETURN', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_SALES_RETURN_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_SALES_RETURN', '"sales:approve"', 'string');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_FIN_ADJUST', '0', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_FIN_ADJUST_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_FIN_ADJUST', '"accounts:manage"', 'string');
