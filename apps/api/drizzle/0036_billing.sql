-- 0036_billing.sql
-- Billing that stays in step with the books.
--
-- 1. A till payment remembers the ledger account it landed in. A "bank"
--    payment used to post to 1010 whatever bank the customer paid into, so a
--    shop with two banks saw one overstated and one understated; and a refund
--    "to the original method" had to guess. Now the sale names the bank
--    account and the refund reverses exactly that account.
ALTER TABLE sales_payments ADD COLUMN account_code TEXT;
ALTER TABLE sales_payments ADD COLUMN bank_account_id TEXT REFERENCES bank_accounts(id);
UPDATE sales_payments SET account_code = CASE method
  WHEN 'cash' THEN '1000'
  WHEN 'card' THEN '1020'
  WHEN 'credit' THEN '1200'
  ELSE '1010' END
WHERE account_code IS NULL;

-- 2. Store credit a customer already held (a negative 1200 balance, e.g.
--    from a return) that settled part of this sale's credit leg. Without it
--    an exchange paid from store credit looks like fresh debt on the invoice.
ALTER TABLE sales_invoices ADD COLUMN store_credit_cents INTEGER NOT NULL DEFAULT 0;
-- Cash handed over at the till, for the change line on the receipt.
ALTER TABLE sales_invoices ADD COLUMN tendered_cents INTEGER;
-- Free-text remark printed on the invoice.
ALTER TABLE sales_invoices ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_receipt_alloc_invoice ON customer_receipt_allocations(invoice_id);

-- 3. Every sale used to be stamped PAID with paid_cents = total, even when
--    the bill went on credit, so "Unpaid" and "Part-paid" were always empty
--    and the balance due never showed. Recompute settlement from the money
--    actually received: till payments other than credit, posted receipts
--    allocated to the invoice, an applied custom-order advance, and credit a
--    return put back against it. Kept identical to settlementStmt().
UPDATE sales_invoices AS si SET
  paid_cents = MIN(si.total_cents, (
    COALESCE((SELECT SUM(sp.amount_cents) FROM sales_payments sp WHERE sp.invoice_id = si.id AND sp.method <> 'credit'), 0)
    + COALESCE((SELECT SUM(a.amount_cents) FROM customer_receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.invoice_id = si.id AND r.status = 'POSTED'), 0)
    + COALESCE((SELECT SUM(al.credit_cents) FROM custom_orders co JOIN journal_entries ae ON ae.ref_entity = 'custom_advance_apply' AND ae.ref_id = co.id JOIN journal_lines al ON al.entry_id = ae.id AND al.account_code = '1200' WHERE co.sale_id = si.id), 0)
    + COALESCE((SELECT SUM(rl.credit_cents) FROM sales_returns sr JOIN journal_lines rl ON rl.entry_id = sr.journal_entry_id AND rl.account_code = '1200' WHERE sr.invoice_id = si.id), 0)
    + si.store_credit_cents
  )),
  status = CASE
    WHEN si.status = 'VOID' THEN 'VOID'
    WHEN (
      COALESCE((SELECT SUM(sp.amount_cents) FROM sales_payments sp WHERE sp.invoice_id = si.id AND sp.method <> 'credit'), 0)
      + COALESCE((SELECT SUM(a.amount_cents) FROM customer_receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.invoice_id = si.id AND r.status = 'POSTED'), 0)
      + COALESCE((SELECT SUM(al.credit_cents) FROM custom_orders co JOIN journal_entries ae ON ae.ref_entity = 'custom_advance_apply' AND ae.ref_id = co.id JOIN journal_lines al ON al.entry_id = ae.id AND al.account_code = '1200' WHERE co.sale_id = si.id), 0)
      + COALESCE((SELECT SUM(rl.credit_cents) FROM sales_returns sr JOIN journal_lines rl ON rl.entry_id = sr.journal_entry_id AND rl.account_code = '1200' WHERE sr.invoice_id = si.id), 0)
      + si.store_credit_cents
    ) >= si.total_cents THEN 'PAID'
    WHEN (
      COALESCE((SELECT SUM(sp.amount_cents) FROM sales_payments sp WHERE sp.invoice_id = si.id AND sp.method <> 'credit'), 0)
      + COALESCE((SELECT SUM(a.amount_cents) FROM customer_receipt_allocations a JOIN customer_receipts r ON r.id = a.receipt_id WHERE a.invoice_id = si.id AND r.status = 'POSTED'), 0)
      + COALESCE((SELECT SUM(al.credit_cents) FROM custom_orders co JOIN journal_entries ae ON ae.ref_entity = 'custom_advance_apply' AND ae.ref_id = co.id JOIN journal_lines al ON al.entry_id = ae.id AND al.account_code = '1200' WHERE co.sale_id = si.id), 0)
      + COALESCE((SELECT SUM(rl.credit_cents) FROM sales_returns sr JOIN journal_lines rl ON rl.entry_id = sr.journal_entry_id AND rl.account_code = '1200' WHERE sr.invoice_id = si.id), 0)
      + si.store_credit_cents
    ) > 0 THEN 'PARTIAL'
    ELSE 'UNPAID'
  END;

-- Settings the printed invoice reads. Blank until the shop fills them in on
-- the Settings page; the invoice simply leaves a blank line out.
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES
  ('shop_address', '""', 'string'),
  ('shop_phone', '""', 'string'),
  ('shop_email', '""', 'string'),
  ('invoice_terms', '"Goods once sold are exchangeable within 14 days with this invoice. Gold value is refunded at the prevailing rate."', 'string');
