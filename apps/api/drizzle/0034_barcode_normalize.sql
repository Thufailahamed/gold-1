-- 0034_barcode_normalize.sql
-- Scanner lookups now normalise input to uppercase and match barcode/sku by
-- plain equality so they use the unique indexes (no UPPER() table scan).
-- Codes have always been minted uppercase; this makes that a guarantee for any
-- hand-entered or legacy row. transfer_lines keeps a copy of the barcode, and
-- the transfer reconcile flags a mismatch, so it is normalised in step.
UPDATE products SET barcode = UPPER(TRIM(barcode)) WHERE barcode <> UPPER(TRIM(barcode));
UPDATE products SET sku = UPPER(TRIM(sku)) WHERE sku IS NOT NULL AND sku <> UPPER(TRIM(sku));
UPDATE transfer_lines SET barcode = UPPER(TRIM(barcode)) WHERE barcode <> UPPER(TRIM(barcode));
