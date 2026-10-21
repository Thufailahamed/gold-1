-- 0050_cheques.sql
-- A cheque taken at the till is cash in the drawer (account 1000), and the
-- cheque details are kept beside the payment so the bill can show them.
CREATE TABLE IF NOT EXISTS sales_payment_cheques (
  payment_id TEXT PRIMARY KEY REFERENCES sales_payments(id),
  cheque_no TEXT,
  cheque_bank TEXT,
  cheque_date TEXT
);
