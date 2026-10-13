-- 0046_exchange.sql
-- Old-for-new exchange: an old-gold purchase settled against a new sale in
-- one atomic batch. The link lets the invoice page and lineage show the
-- jewellery the bill was traded against.
ALTER TABLE old_gold_purchases ADD COLUMN sales_invoice_id TEXT REFERENCES sales_invoices(id);
CREATE INDEX IF NOT EXISTS idx_ogp_invoice ON old_gold_purchases(sales_invoice_id);
