# GoldOS — Custom Orders Design (Slice 2 of Repairs & Custom Orders)

Date: 2026-09-28
Status: Approved (wrapper around existing engines, buy-then-allocate, 2200 advances, POS-sale delivery)
Scope: Quotation → advance → gold sourcing → manufacturing link → QC → delivery with balance payment, with complete gold lineage. Repairs shipped as Slice 1.

## 1. Context

Manufacturing CUSTOMER orders (customer-bound DRAFT → materials from approved same-branch melt lots → produce → QC → finish minting JW- products with ledger postings) and POS sales (split payments, discount gates, 4000/5000/1100/1200 postings) are tested engines. Old-gold purchase posts counter value with lineage into melting. What is missing is the wrapper that binds them to one customer promise: the quote, the advances, the earmarked gold, and the delivery linkage.

User-confirmed decisions:
- Customer-supplied gold is bought first (normal purchase flow), then earmarked — shop, customer, and mixed sources flow identically afterward.
- Advances book to 2200 Other Payables with the customer party (no chart change).
- Delivery is a POS sale of the finished piece at the quoted price.

## 2. Schema (migration `0025_custom_orders`)

```sql
CREATE TABLE custom_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE, -- CORD-000001 via counters
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  design TEXT NOT NULL,
  description TEXT,
  gold_req_mg INTEGER NOT NULL,
  gold_source TEXT NOT NULL, -- CUSTOMER | SHOP | MIXED
  quote_cents INTEGER NOT NULL,
  advance_cents INTEGER NOT NULL DEFAULT 0,
  manufacturing_order_id TEXT REFERENCES manufacturing_orders(id),
  sale_id TEXT REFERENCES sales_invoices(id),
  status TEXT NOT NULL DEFAULT 'QUOTE', -- QUOTE | ADVANCED | IN_PRODUCTION | QC_PASSED | READY | DELIVERED | CANCELLED
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_co_status ON custom_orders(status);
CREATE INDEX idx_co_customer ON custom_orders(customer_id);

CREATE TABLE custom_order_gold (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES custom_orders(id),
  kind TEXT NOT NULL, -- CUSTOMER_OLDGOLD | SHOP_LOT
  ref_id TEXT NOT NULL, -- old_gold_items.id | melting_outputs row id (batch+lot)
  fine_mg INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_cog_order_ref ON custom_order_gold(order_id, kind, ref_id);
CREATE INDEX idx_cog_order ON custom_order_gold(order_id);

INSERT INTO counters (name, next) VALUES ('CORD', 1);
```

- Earmarks are links, not movements: the gold moves only through the standard purchase/melt/manufacture postings. Double-earmark of one lot/OG item to two orders is refused by the unique index.
- `advance_cents` is a tracked sum of posted advance entries (derived discipline: always updated in the same batch as the entry).

## 3. Flow (each step one batch with audit; links only, engines do the work)

- `POST /custom-orders` (`mfg:create`): `{ customerId, branchId, design, description?, goldReqG, goldSource, quoteLkr }`. No postings. Status QUOTE.
- `POST /custom-orders/:id/advance { amountLkr, method, bankAccountId? }` (`accounts:manage`): posts DR cash/card/named-bank / CR 2200 customer party (`ref_entity: 'custom_advance'`), bumps `advance_cents`, moves QUOTE → ADVANCED. Accepted in QUOTE/ADVANCED only; refused when it would push `advance_cents` past `quote_cents`. `custom_advance` joins `KNOWN_CASH_REFS` (cash-in, "Customer advances") so day-close names it.
- `POST /custom-orders/:id/source { kind, refId }` (`mfg:edit`): earmarks. CUSTOMER_OLDGOLD: ref must be a PURCHASED old-gold item of the same customer (bought through the normal flow first — the endpoint refuses unvalued/unpurchased items). SHOP_LOT: ref must be an APPROVED same-branch melt lot with remaining fine weight (same checks as `addMaterials`). MIXED orders take both kinds.
- `POST /custom-orders/:id/start-production` (`mfg:edit`): QUOTE/ADVANCED → IN_PRODUCTION. Creates the CUSTOMER manufacturing order (design/customer/branch from the order) or links a caller-supplied DRAFT one (same branch+customer, else 409), storing `manufacturing_order_id`.
- Materials/produce/QC/finish run the standard mfg endpoints against the linked order, with one wrapper guard: `addMaterials` calls on the linked order accept only earmarked lots (checked in the wrapper before delegating; non-earmarked → 409). The custom order mirrors production progress via `POST /custom-orders/:id/sync` (`mfg:view`): linked MO QC_PASSED → order QC_PASSED, MO COMPLETE → order READY (finished JW- product id recorded on the order by the mfg path already). No other writer may set these two states.
- `POST /custom-orders/:id/deliver { payments[] }` (`sales:create`): READY → DELIVERED. (1) Apply advances: DR 2200 / CR 1200 customer party up to quoted total (refused if advances exceed quote — impossible by the cap, checked anyway). (2) POS `receiveSale` of the finished piece at `quote_cents` (price override to quote; discount gates apply; balance paid alongside or left as credit). Stores `sale_id`. Receivable after both steps equals quote − advances − balance paid; applying more advance than the invoice total is refused.
- `POST /custom-orders/:id/cancel { reason }` (`mfg:edit` before IN_PRODUCTION, `mfg:approve` after): releases earmarks; posted advances refund via reversing 2200 entries with reason (never deletes). Post-READY cancel is refused — deliver or reverse the sale.
- `GET /custom-orders/:id/lineage` (`mfg:view`): walks customer → OG purchases → melt batches/lots → MO → JW- product → SINV by reusing `GET /gold/lineage` per link plus order earmarks. Complete trace, zero new ledger rows.

## 4. Permissions and scoping

`mfg:create`/`mfg:edit` for quote/source/start/cancel-pre, `mfg:approve` for QC + cancel-post, `accounts:manage` for advances, `sales:create` for delivery, `mfg:view` for read/lineage. Branch member rule throughout; list filters branch/customer/status. No new permission (count stays 53).

## 5. No-fabrication guards

- Quotation is a recorded offer, never revenue: nothing posts until advance/production/delivery move through their engines.
- Advance sum is capped at quote; over-application at delivery refused with figures named.
- Earmarks can't double-book one lot/OG across orders (unique index).
- Cancel never deletes: earmarks released, advances reversed, rows kept.

## 6. Testing

- Earmark enforcement (non-earmarked lot to linked MO → 409; double-earmark → 409; wrong-branch lot → 409).
- Advance cap (over-quote → 409; second advance breaching cumulative → 409).
- Delivery math on seed (quote 500, advance 100, balance 400 → receivable 0; partial balance → exact remainder; over-apply → 409).
- Lineage walk end-to-end (OG → MELT → MO → JW → SINV all resolve).
- `custom_advance` classified cash-in; cancel post-READY → 409.

## 7. Out of scope

- Monthly Slices 2–3. Web UI for both slices (these endpoints are its contract).
