# GoldOS — Product & Barcode Foundation Design (Camera Excluded)

Date: 2026-09-28
Status: Approved
Scope: Catalog expansion, decimal migration, JW- identifiers (+OG/MELT/MO/REP
reserved), R2 images, product edit, inventory ledger with 11 statuses and
immutable movements, full product/barcode/inventory UI. No POS/sales.
Camera scanning is a separate next spec.

## 1. Context

Phases 1–4 shipped foundation (8 roles, 28 perms), masters, unique-piece
products (PRD- barcodes, REAL weights, statuses in_stock/sold/void), and
Code128 SVG labels. This phase completes the product/barcode/inventory
foundation. Approach: ledger-first immutable movements (A); in-place status
edits (B) rejected; dual-column decimals (C) rejected in favor of one-time
in-place conversion of test-stage data.

Decisions (user-confirmed):
- Camera scanning split into its own later spec.
- PRD- barcodes grandfathered; new jewellery items get JW-.
- Integer minor units (mg + cents).
- Ledger infra now; non-foundation transitions locked to future modules.

## 2. Catalog expansion (migration 0005_catalog)

New masters: `subcategories(id, category_id FK, name, code UNIQUE)`,
`designs(id, name, code UNIQUE)`, `product_types(id, name, code UNIQUE)`,
`metal_types(id, name, code UNIQUE)` seeded GOLD/SILVER/PLATINUM,
`stone_types(id, name, code UNIQUE)` seeded NONE/DIAMOND/RUBY/SAPPHIRE/EMERALD/PEARL.
Products gain: `sku` auto `SKU-XXXXXX` UNIQUE, `subcategory_id?`,
`design_id?`, `product_type_id?`, `metal_type_id` (default gold row),
`stone_type_id?`, `wastage_mg DEFAULT 0`, `fine_gold_mg` (stored, computed),
`cost_cents?`, `selling_price_cents?`, `location?`, `notes?`, `image_keys`
JSON array. New barcodes `JW-XXXXXX` (same alphabet/retry as PRD-);
lookup regex `^(PRD|JW)-[A-Z0-9]{6}$`; OG/MELT/MO/REP prefixes reserved,
no tables yet. `PATCH /products/:id` edits refs/charges/cost/price/location/
notes; weights immutable (correction = VOID + recreate). Images:
`POST /products/:id/images` (multipart, ≤5MB, jpeg/png/webp → R2 key
`products/{id}/{uuid}.{ext}`, max 10 per product) and
`GET /products/:id/images/:key` (streams from R2, products:view).

## 3. Decimal strategy (migration 0006_decimal)

Weights → INTEGER mg; money → INTEGER cents; purity → INTEGER permille
(916). Conversion `ROUND(x*1000)` / `ROUND(x*100)` via table rebuild
(new table + copy + drop + rename) for purities, gold_rates, suppliers,
customers, products. API contract unchanged in shape (grams ≤3dp, LKR ≤2dp)
via Zod boundary transforms `gToMg`/`lkrToCents`; all server math in
integers; single final rounding. `fine_gold_mg = ROUND(net_mg × permille /
1000)`; live price computed in minor units, rounded once to cents.
Display divides by 1000/100. Drizzle schema mirrors new columns;
`BARCODE_RE` updated to `/^(PRD|JW)-[A-Z0-9]{6}$/`.

## 4. Inventory ledger (migration 0007_inventory)

`stock_movements(id, product_id FK, type, from_status, to_status,
from_branch, to_branch, weight_mg, reason, created_at, created_by)` —
append-only. `products.status` CHECKed to IN_STOCK, RESERVED, SOLD,
RETURNED, IN_REPAIR, IN_MANUFACTURING, TRANSFER_PENDING, MELTING, MELTED,
LOST, VOID; old values mapped in_stock→IN_STOCK, sold→SOLD, void→VOID.
Allowed now: intake (*→IN_STOCK, auto on create), transfer
(IN_STOCK→TRANSFER_PENDING→IN_STOCK with to_branch, two rows),
RETURNED/LOST/VOID from eligible states (reason required). Everything else
→ 409 TRANSITION_LOCKED. Endpoints: `POST /inventory/movements`,
`GET /inventory/movements` (product/branch/type filters),
`GET /inventory/stock?groupBy=branch|purity|product` (totals in mg + value
at current rates). Movement POST needs products:edit (VOID path
products:cancel). Create/void auto-write movements in the same batch.

## 5. UI

Products list: filters category/purity/branch/status/weight-range/
price-range (server params). Create/edit form with selects for new refs,
image uploader with previews. Detail: fine-gold, cost/price, location,
notes, gallery, movement-history tab. `/scan`: large auto-focus input
(manual + USB Enter), recent scans, result → detail. Print view: label
preview + copy count, print CSS. Inventory screen: grouped stock table
with gram + value totals, movement history with filters. Camera: excluded.

## 6. Data flow example

Intake: validate (refs active, weights sane) → batch [INSERT product,
INSERT stock_movements IN_STOCK, INSERT audit] → 201 with barcode+SKU.
Transfer: validate ownership branch + IN_STOCK → batch [UPDATE status
TRANSFER_PENDING, INSERT movement out, UPDATE branch+status IN_STOCK,
INSERT movement in, INSERT audit] → 200. Any failure → rollback.

## 7. Testing

Vitest: boundary transforms (1.234g→1234mg, round-trip), fine-gold math,
transition allowlist (SOLD rejected with TRANSITION_LOCKED), barcode regex
both prefixes. Live gate: full product→barcode→inventory workflow —
create, scan lookup, transfer between branches, stock totals change,
movement history shows all rows, void blocks edits, cashier cannot move
stock, label still renders under mg columns.

## 8. Out of scope

POS/sales (SOLD via sale), old gold (OG-), melting (MELT-), manufacturing
(MO-), repairs (REP-), camera scanning, financial ledger postings.

## 9. Self-review

- No TBD/TODO; prefixes, statuses, transitions, units, limits explicit.
- Consistent: batch+audit, guards, branch scoping, sidebar gating extended;
  PRD- grandfathering avoids breaking printed labels; weight immutability
  preserves traceability.
- Single plan: three migrations, one ledger, one UI set — large but cohesive;
  camera deliberately excluded.
- Unambiguous: mg/cents/permille units, TRANSITION_LOCKED semantics,
  image limits, void-recreate correction policy fixed.
