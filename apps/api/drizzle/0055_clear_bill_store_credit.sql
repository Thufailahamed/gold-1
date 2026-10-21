-- 0055_clear_bill_store_credit.sql
-- One-time correction. On SINV-0006 the old gold left over after the bill (160,000 LKR)
-- went to the customer's store credit but was never applied to an open bill, so the
-- customer's ledger (240,000) and their open bills (400,000) disagreed. The credit now
-- settles SINV-0002, the oldest open bill. Matched by invoice id, so no other shop is touched,
-- and guarded on the paid amount, so it cannot apply twice.
UPDATE sales_invoices
SET store_credit_cents = store_credit_cents + 16000000,
    paid_cents = paid_cents + 16000000,
    status = CASE WHEN paid_cents + 16000000 >= total_cents THEN 'PAID' ELSE 'PARTIAL' END
WHERE id = '34b3a2bd-588a-4234-acc0-9eafe3ff2831' AND paid_cents = 6000000;
