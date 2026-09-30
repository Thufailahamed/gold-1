-- GoldOS control plane. Lives in its own D1 database (binding PLATFORM_DB),
-- separate from every shop's business data. Conventions match the data plane:
-- TEXT UUID ids, INTEGER epoch-millis timestamps, INTEGER cents.

-- ---------------------------------------------------------------- Staff

CREATE TABLE platform_admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'operations', 'billing', 'support', 'analyst')),
  is_active INTEGER NOT NULL DEFAULT 1,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_login_at INTEGER,
  last_login_ip TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);

-- Only the SHA-256 of the cookie token is stored: a leaked row cannot be replayed.
CREATE TABLE platform_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  mfa_pending INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_psessions_admin ON platform_sessions(admin_id);

-- ---------------------------------------------------------------- Catalogue

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_monthly_cents INTEGER NOT NULL DEFAULT 0,
  price_yearly_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'LKR',
  trial_days INTEGER NOT NULL DEFAULT 14,
  -- NULL limit = unlimited
  max_users INTEGER,
  max_branches INTEGER,
  max_products INTEGER,
  max_storage_mb INTEGER,
  features_json TEXT NOT NULL DEFAULT '[]',
  is_public INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 100),
  duration_months INTEGER,             -- NULL = forever
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

-- ---------------------------------------------------------------- Accounts

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  phone TEXT,
  country TEXT NOT NULL DEFAULT 'LK',
  currency TEXT NOT NULL DEFAULT 'LKR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Colombo',
  region TEXT NOT NULL DEFAULT 'apac',
  custom_domain TEXT UNIQUE,
  -- Which data-plane database serves this account (D1 database id or binding name).
  data_plane TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  -- MANUAL suspensions are lifted by staff; BILLING ones lift when the debt is paid.
  suspension_kind TEXT CHECK (suspension_kind IN ('MANUAL', 'BILLING')),
  suspended_reason TEXT,
  suspended_at INTEGER,
  deletion_scheduled_at INTEGER,
  last_active_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_created ON tenants(created_at);

-- One live subscription per account; history is subscription_events.
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED')),
  billing_interval TEXT NOT NULL DEFAULT 'MONTH' CHECK (billing_interval IN ('MONTH', 'YEAR')),
  -- Locked per-interval price, so a list-price change never silently reprices an account.
  price_cents INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  coupon_id TEXT REFERENCES coupons(id),
  discount_ends_at INTEGER,
  trial_ends_at INTEGER,
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at INTEGER,
  cancel_reason TEXT,
  past_due_since INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_subs_status ON subscriptions(status);
CREATE INDEX idx_subs_period_end ON subscriptions(current_period_end);

-- Append-only. mrr_delta_cents drives the MRR trend and movement reports.
CREATE TABLE subscription_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  type TEXT NOT NULL,
  from_plan_id TEXT,
  to_plan_id TEXT,
  from_status TEXT,
  to_status TEXT,
  mrr_before_cents INTEGER NOT NULL DEFAULT 0,
  mrr_after_cents INTEGER NOT NULL DEFAULT 0,
  mrr_delta_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_subevents_tenant ON subscription_events(tenant_id, created_at);
CREATE INDEX idx_subevents_time ON subscription_events(created_at);

CREATE TABLE tenant_notes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES platform_admins(id)
);
CREATE INDEX idx_tnotes_tenant ON tenant_notes(tenant_id, created_at);

CREATE TABLE usage_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  users INTEGER NOT NULL DEFAULT 0,
  branches INTEGER NOT NULL DEFAULT 0,
  products INTEGER NOT NULL DEFAULT 0,
  sales_30d INTEGER NOT NULL DEFAULT 0,
  sales_30d_cents INTEGER NOT NULL DEFAULT 0,
  storage_mb INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER,
  captured_at INTEGER NOT NULL
);
CREATE INDEX idx_usage_tenant ON usage_snapshots(tenant_id, captured_at);

-- ---------------------------------------------------------------- Billing

CREATE TABLE platform_counters (name TEXT PRIMARY KEY, next INTEGER NOT NULL);
INSERT INTO platform_counters (name, next) VALUES ('INV', 1), ('TKT', 1);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  kind TEXT NOT NULL DEFAULT 'SUBSCRIPTION' CHECK (kind IN ('SUBSCRIPTION', 'MANUAL')),
  period_start INTEGER,
  period_end INTEGER,
  currency TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE')),
  issued_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  paid_at INTEGER,
  voided_at INTEGER,
  void_reason TEXT,
  memo TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
-- A period is billed once, however many times the cycle runs.
CREATE UNIQUE INDEX uq_invoice_period ON invoices(subscription_id, period_start) WHERE kind = 'SUBSCRIPTION' AND status != 'VOID';
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id, issued_at);
CREATE INDEX idx_invoices_status ON invoices(status, due_at);

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE INDEX idx_invlines_invoice ON invoice_lines(invoice_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('BANK', 'CARD', 'CASH', 'ONLINE', 'OTHER')),
  reference TEXT,
  received_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_payments_tenant ON payments(tenant_id, received_at);
CREATE INDEX idx_payments_time ON payments(received_at);

-- ---------------------------------------------------------------- Product controls

CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  default_enabled INTEGER NOT NULL DEFAULT 0,
  rollout_pct INTEGER NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tenant_feature_overrides (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  flag_key TEXT NOT NULL REFERENCES feature_flags(key),
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (tenant_id, flag_key)
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  audience TEXT NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL', 'PLAN', 'TENANT')),
  audience_ref TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  starts_at INTEGER,
  ends_at INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_announcements_status ON announcements(status);

-- ---------------------------------------------------------------- Support

CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED')),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  category TEXT NOT NULL DEFAULT 'general',
  requester_email TEXT,
  assignee_id TEXT REFERENCES platform_admins(id),
  first_response_at INTEGER,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tickets_status ON support_tickets(status, priority);
CREATE INDEX idx_tickets_tenant ON support_tickets(tenant_id, created_at);

CREATE TABLE support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
  author_type TEXT NOT NULL CHECK (author_type IN ('ADMIN', 'TENANT', 'SYSTEM')),
  author_id TEXT,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_smessages_ticket ON support_messages(ticket_id, created_at);

-- ---------------------------------------------------------------- Security & ops

-- Single-use, short-lived. Only the hash is stored.
CREATE TABLE impersonation_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  admin_id TEXT NOT NULL REFERENCES platform_admins(id),
  target_email TEXT NOT NULL,
  reason TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_impersonation_tenant ON impersonation_grants(tenant_id, created_at);

CREATE TABLE platform_audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  tenant_id TEXT,
  prev_json TEXT,
  new_json TEXT,
  reason TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_paudit_time ON platform_audit_logs(created_at);
CREATE INDEX idx_paudit_tenant ON platform_audit_logs(tenant_id, created_at);
CREATE INDEX idx_paudit_entity ON platform_audit_logs(entity, entity_id);
CREATE INDEX idx_paudit_admin ON platform_audit_logs(admin_id, created_at);

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'OK', 'FAILED')),
  summary_json TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  triggered_by TEXT
);
CREATE INDEX idx_jobruns_job ON job_runs(job, started_at);

-- ---------------------------------------------------------------- Seed

INSERT INTO plans (id, code, name, description, price_monthly_cents, price_yearly_cents, currency, trial_days, max_users, max_branches, max_products, max_storage_mb, features_json, is_public, is_active, sort_order, created_at, updated_at) VALUES
  ('plan-starter', 'starter', 'Starter', 'A single counter: POS, catalog, gold rates and old-gold intake.', 950000, 9500000, 'LKR', 14, 5, 1, 2000, 1024,
   '["pos","oldgold","barcode_labels"]', 1, 1, 10, 0, 0),
  ('plan-growth', 'growth', 'Growth', 'Multi-branch shops: transfers, full accounts, day closing and analytics.', 2450000, 24500000, 'LKR', 14, 25, 5, 20000, 10240,
   '["pos","oldgold","barcode_labels","multi_branch","accounts","day_closing","analytics","repairs","custom_orders"]', 1, 1, 20, 0, 0),
  ('plan-enterprise', 'enterprise', 'Enterprise', 'Workshops and chains: manufacturing, melting, approvals and priority support.', 6500000, 65000000, 'LKR', 30, NULL, NULL, NULL, 102400,
   '["pos","oldgold","barcode_labels","multi_branch","accounts","day_closing","analytics","repairs","custom_orders","manufacturing","melting","approvals","priority_support","api_access"]', 1, 1, 30, 0, 0);

INSERT INTO feature_flags (key, description, default_enabled, rollout_pct, created_at, updated_at) VALUES
  ('pos', 'Point of sale counter', 1, 0, 0, 0),
  ('oldgold', 'Old gold intake, testing and purchase', 1, 0, 0, 0),
  ('barcode_labels', 'Barcode label printing', 1, 0, 0, 0),
  ('multi_branch', 'More than one branch, with stock and cash transfers', 0, 0, 0, 0),
  ('accounts', 'Full double-entry accounts suite', 0, 0, 0, 0),
  ('day_closing', 'Day closing and cash reconciliation', 0, 0, 0, 0),
  ('analytics', 'Branch analytics dashboards', 0, 0, 0, 0),
  ('repairs', 'Repair job tracking', 0, 0, 0, 0),
  ('custom_orders', 'Customer custom orders', 0, 0, 0, 0),
  ('manufacturing', 'Workshop manufacturing orders', 0, 0, 0, 0),
  ('melting', 'Melting batches and gold recovery', 0, 0, 0, 0),
  ('approvals', 'Maker-checker approval center', 0, 0, 0, 0),
  ('priority_support', 'Priority support queue', 0, 0, 0, 0),
  ('api_access', 'Public API keys', 0, 0, 0, 0),
  ('beta.new_pos', 'Redesigned POS (beta)', 0, 0, 0, 0);
