-- 0041_price_override.sql
-- The till may sell a piece above or below its shelf price. price_cents stays
-- the price actually charged (revenue, tax and refunds all read it); this
-- column keeps the shelf price the cashier was shown, so the markdown or
-- mark-up is always recoverable. NULL = sold at shelf (every earlier sale).
ALTER TABLE sales_items ADD COLUMN list_price_cents INTEGER;
