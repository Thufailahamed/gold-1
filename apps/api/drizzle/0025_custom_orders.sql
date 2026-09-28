-- 0025_custom_orders.sql
-- Custom-order wrapper: links only, engines move the gold and money.
CREATE TABLE custom_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  design TEXT NOT NULL,
  description TEXT,
  gold_req_mg INTEGER NOT NULL,
  gold_source TEXT NOT NULL,
  quote_cents INTEGER NOT NULL,
  advance_cents INTEGER NOT NULL DEFAULT 0,
  manufacturing_order_id TEXT REFERENCES manufacturing_orders(id),
  sale_id TEXT REFERENCES sales_invoices(id),
  status TEXT NOT NULL DEFAULT 'QUOTE',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_co_status ON custom_orders(status);
CREATE INDEX idx_co_customer ON custom_orders(customer_id);

CREATE TABLE custom_order_gold (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES custom_orders(id),
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  fine_mg INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_cog_order_ref ON custom_order_gold(order_id, kind, ref_id);
CREATE INDEX idx_cog_order ON custom_order_gold(order_id);

INSERT INTO counters (name, next) VALUES ('CORD', 1);
