-- 0016_ledger_backfill.sql
-- Groups the pre-0015 flat journal rows into real entries, converts party
-- opening balances into entries against 3100, and links documents to their
-- entry. Idempotent: every step is guarded, so a re-run is a no-op.
--
-- D1's SQLite has no HASH() function, so a group is identified by the MIN of
-- its own line ids. Those ids are crypto.randomUUID() values — unique, stable
-- across runs, and already in the table — which makes MIN(l.id) a deterministic
-- group key with no hashing needed.

-- A header per (ref_entity, ref_id, created_at, branch_id). created_at is part
-- of the key because a purchase void posts with the SAME ref_entity and
-- ref_id as the receive it reverses; only the timestamp separates them.
--
-- entry_no is numbered with ROW_NUMBER over the grouped set, ordered by the
-- group's own first line. COUNT(*) would be the number of LINES in the group,
-- not its ordinal, so every two-line group would collide on the UNIQUE index.
-- The 'JE-B' prefix marks these as backfilled so they cannot be confused with
-- a live JE-000001 sequence, which starts fresh in 0015.
INSERT INTO journal_entries (id, entry_no, entry_date, memo, ref_entity, ref_id,
                             ref_no, source_module, status, branch_id, created_at, created_by)
SELECT
  'je-' || MIN(l.id),
  'JE-B' || substr('000000' || CAST(ROW_NUMBER() OVER (ORDER BY l.created_at, MIN(l.id)) AS TEXT), -6, 6),
  date(CAST(l.created_at / 1000 AS INTEGER), 'unixepoch', '+330 minutes'),
  l.memo,
  l.ref_entity,
  l.ref_id,
  NULL,
  CASE l.ref_entity
    WHEN 'sale_invoice'      THEN 'sales'
    WHEN 'sale_return'       THEN 'sales'
    WHEN 'purchase_invoice'  THEN 'purchases'
    WHEN 'purchase_payment'  THEN 'purchases'
    WHEN 'old_gold_purchase' THEN 'oldgold'
    ELSE 'manual'
  END,
  'POSTED',
  l.branch_id,
  l.created_at,
  l.created_by
FROM journal_lines l
WHERE l.entry_id IS NULL
GROUP BY l.ref_entity, l.ref_id, l.created_at, l.branch_id;

-- SQLite's rowid is not guaranteed to survive a table rename, so each line
-- re-derives its group by the same key rather than joining on a rowid.
UPDATE journal_lines AS l
SET entry_id = 'je-' || (
  SELECT MIN(x.id) FROM journal_lines x
  WHERE x.ref_entity = l.ref_entity AND x.ref_id = l.ref_id
    AND x.created_at = l.created_at AND x.branch_id IS l.branch_id
)
WHERE l.entry_id IS NULL;

-- line_no must be deterministic, so order by the line's own content rather than
-- by insertion order. Row-value comparison keeps this to a single statement.
UPDATE journal_lines AS l
SET line_no = (
  SELECT COUNT(*) FROM journal_lines x
  WHERE x.entry_id = l.entry_id
    AND (x.account_code, x.debit_cents, x.credit_cents, COALESCE(x.party_id, '-'))
      < (l.account_code, l.debit_cents, l.credit_cents, COALESCE(l.party_id, '-'))
)
WHERE l.entry_id IS NOT NULL;

-- Party opening balances become real entries against 3100.
--
-- Both columns are stored positive-means-"this party owes us more": a positive
-- customers.opening_balance_cents means the customer owes us, and a positive
-- suppliers.opening_balance_cents means we owe the supplier. Negating the
-- supplier figure puts both on one scale, so `amount > 0` always means "this
-- party's balance goes up", which is a DEBIT on their own control account.
-- This reproduces the retired formulas exactly:
--   customer: opening + ΣDR − ΣCR   |   supplier: opening + ΣCR − ΣDR
INSERT INTO journal_entries (id, entry_no, entry_date, memo, ref_entity, ref_id,
                             ref_no, source_module, status, branch_id, created_at, created_by)
SELECT
  'je-open-' || p.kind || '-' || p.id,
  'JE-OPEN-' || substr(upper(hex(randomblob(4))), 1, 8),
  date(CAST(p.created_at / 1000 AS INTEGER), 'unixepoch', '+330 minutes'),
  'Opening balance migrated from party record',
  'opening_balance',
  p.id,
  p.code,
  'manual',
  'POSTED',
  p.branch_id,
  p.created_at,
  p.created_by
FROM (
  SELECT 'customer' AS kind, id, code, branch_id, opening_balance_cents AS amount,
         created_at, created_by
  FROM customers WHERE opening_balance_cents <> 0
  UNION ALL
  SELECT 'supplier', id, code, branch_id, -opening_balance_cents, created_at, created_by
  FROM suppliers WHERE opening_balance_cents <> 0
) p;

-- Debit side: on the party's own control account, carrying the party tag so it
-- appears in their sub-ledger. Positive amount takes the debit, negative the credit.
INSERT INTO journal_lines (id, entry_id, line_no, account_code, debit_cents, credit_cents, party_type, party_id, memo)
SELECT
  'jl-open-' || p.kind || '-' || p.id || '-d',
  'je-open-' || p.kind || '-' || p.id,
  CASE WHEN p.amount > 0 THEN 1 ELSE 2 END,
  CASE WHEN p.amount > 0 THEN '1200' ELSE '2000' END,
  CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END,
  CASE WHEN p.amount > 0 THEN 0 ELSE -p.amount END,
  CASE WHEN p.amount > 0 THEN 'customer' ELSE 'supplier' END,
  p.id,
  'Opening balance migrated from party record'
FROM (
  SELECT 'customer' AS kind, id, opening_balance_cents AS amount FROM customers WHERE opening_balance_cents <> 0
  UNION ALL
  SELECT 'supplier', id, -opening_balance_cents FROM suppliers WHERE opening_balance_cents <> 0
) p;

-- Credit side: the same amount on 3100, so the pair nets to zero by
-- construction rather than by a second CASE. party_type stays NULL so the
-- party sub-ledger only ever holds their own control account.
INSERT INTO journal_lines (id, entry_id, line_no, account_code, debit_cents, credit_cents, party_type, party_id, memo)
SELECT
  'jl-open-' || p.kind || '-' || p.id || '-c',
  'je-open-' || p.kind || '-' || p.id,
  CASE WHEN p.amount > 0 THEN 2 ELSE 1 END,
  '3100',
  CASE WHEN p.amount > 0 THEN 0 ELSE -p.amount END,
  CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END,
  NULL,
  p.id,
  'Opening balance migrated from party record'
FROM (
  SELECT 'customer' AS kind, id, opening_balance_cents AS amount FROM customers WHERE opening_balance_cents <> 0
  UNION ALL
  SELECT 'supplier', id, -opening_balance_cents FROM suppliers WHERE opening_balance_cents <> 0
) p;

-- Link each posting-bearing document to the header that recorded it. A purchase
-- void shares ref_entity and ref_id with the receive, so the EARLIEST entry for
-- the document is the receive, which is the one a void must reverse.
UPDATE purchase_invoices
SET journal_entry_id = (
  SELECT e.id FROM journal_entries e
  WHERE e.ref_entity = 'purchase_invoice' AND e.ref_id = purchase_invoices.id
  ORDER BY e.created_at, e.id LIMIT 1
);

UPDATE sales_invoices
SET journal_entry_id = (
  SELECT e.id FROM journal_entries e
  WHERE e.ref_entity = 'sale_invoice' AND e.ref_id = sales_invoices.id
  ORDER BY e.created_at, e.id LIMIT 1
);

UPDATE old_gold_purchases
SET journal_entry_id = (
  SELECT e.id FROM journal_entries e
  WHERE e.ref_entity = 'old_gold_purchase' AND e.ref_id = old_gold_purchases.id
  ORDER BY e.created_at, e.id LIMIT 1
);
