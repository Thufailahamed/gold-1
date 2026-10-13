-- SaaS self-serve: automatic D1-per-shop.
-- `tenant_databases` maps an account to its auto-created D1 (reached over the
-- D1 REST API — no wrangler bindings, no fleet cap). `tenant_members` is the
-- central login index so shop-picker lookup never fans out to N databases.
-- `tenant_receipts` keeps billing evidence in the control plane so it
-- survives a shop archive. Slug reservation is enforced in the app, not here.

CREATE TABLE tenant_databases (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  d1_id TEXT NOT NULL UNIQUE,
  d1_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, email)
);
CREATE INDEX idx_members_email ON tenant_members(email);

CREATE TABLE tenant_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  r2_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  bank_ref TEXT,
  reject_reason TEXT,
  uploaded_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT
);
CREATE INDEX idx_receipts_tenant ON tenant_receipts(tenant_id, created_at);
CREATE INDEX idx_receipts_invoice ON tenant_receipts(invoice_id);
CREATE INDEX idx_receipts_status ON tenant_receipts(status, created_at);
