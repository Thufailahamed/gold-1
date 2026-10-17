-- Two guards the service only checked before writing, so two concurrent
-- requests could both pass: a bill line is returned at most once, and a piece
-- can only be put on a bill while it is for sale. Inside the sale/return batch
-- these abort and roll the whole batch back.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_return_items_item ON sales_return_items(invoice_item_id);
CREATE TRIGGER IF NOT EXISTS trg_sales_items_product_available
BEFORE INSERT ON sales_items
WHEN (SELECT status FROM products WHERE id = NEW.product_id) NOT IN ('IN_STOCK', 'RESERVED')
BEGIN
  SELECT RAISE(ABORT, 'Product not available');
END;
