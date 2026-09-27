# GoldOS — Phase 3 Products + Barcodes Design

Date: 2026-09-28
Status: Approved
Scope: Product catalog of unique pieces + PRD- barcodes, Code128 labels,
scan lookup. No inventory movements, no images, no POS/sales.

## 1. Context

Phase 2 (masters: categories, purities, gold rates, suppliers, customers) is
complete and deployed (API on Workers, remote D1 migrated 0001 + 0002). This
spec covers the catalog slice: unique-piece products FK'd to masters with
server-generated barcodes and printable labels. Approach: unique pieces +
on-demand server SVG labels (options A + C); SKU/quantity (B) rejected as
wrong for weighed jewellery; client-side barcode rendering rejected to keep
one source of truth.

Decisions (user-confirmed):
- Catalog + barcodes only; inventory, images deferred.
- Each physical piece is unique (own barcode, weights, price).
- Live pricing: net weight × current rate + making charge.
- Code128 labels with weight/purity/price; USB scanners as keyboard input.

## 2. Data model (migration 0003_products, never edit 0001/0002)

- `products(id TEXT PK, barcode TEXT UNIQUE ('PRD-' + 6 uppercase alnum),
  category_id FK categories, purity_id FK purities, name TEXT,
  gross_weight REAL, stone_weight REAL DEFAULT 0, net_weight REAL,
  making_charge REAL DEFAULT 0, status TEXT DEFAULT 'in_stock'
  ('in_stock'|'sold'|'void'), branch_id FK branches, created_at,
  created_by FK users)`
- Rules: net = gross − stone, reject if negative; category/purity must exist
  and be active; barcode collision → regenerate, max 5 retries; no route sets
  `sold` (reserved for POS phase); void requires reason; no hard deletes.
- All writes batched with audit_logs rows.

## 3. API + pricing + permissions

- `POST /products` — validates `createProductSchema` (shared), active
  category/purity, auto-generates barcode; 201.
- `GET /products` — `?search=&page=&limit=&status=&categoryId=&branchId=`,
  returns `{ rows, total }`.
- `GET /products/:id` — detail + computed `livePrice { amount, ratePerGram,
  rateEffectiveFrom }` or `livePrice: null` with `no_rate: true`.
- `PATCH /products/:id/void` — `{ reason }` required; sets status void + audit.
- `GET /products/barcode/:code` — scan lookup, same payload as detail.
  Case-insensitive exact match on barcode.
- `GET /products/:id/label` — Code128 SVG (`bwip-js`, Workers-safe, no DOM)
  with name, barcode, gross/net weight, karat, live price; served as
  `image/svg+xml`; no R2 storage (rendered on demand).
- Pricing: `net_weight × currentGoldRates(purity) + making_charge` via
  existing service; rates never hard-coded.
- Permissions `products:read`, `products:write`: admin + manager both,
  cashier read, viewer none. Added to `PERMISSIONS`, `DEFAULT_ROLES`,
  `seed.ts`, and migration grants (same pattern as masters).

## 4. Web UI

- Products page: `MasterCrud` table + create dialog extended with
  category/purity `<select>` (from masters endpoints) and numeric fields
  (gross, stone, making charge; net preview = gross − stone).
- Detail view: specs, live-price card (rate + effective timestamp or
  "no rate published" empty state), barcode SVG preview, Print button
  (print CSS isolates the label).
- Scan field in page header: enter/scan `PRD-…` + Enter → detail. Works with
  USB/Bluetooth scanners; camera scanning deferred (no new dependency).
- Sidebar "Products" gated by `products:read`. Audit page picks up
  `product.*` events with no changes.

## 5. Data flow example

Create product: validate → requireAuth + `products:write` → check
category/purity active → generate unique barcode → D1 batch [INSERT
products, INSERT audit_logs] → 201. Any step fails → full rollback.

## 6. Testing

Vitest: `createProductSchema` (negative gross rejected, stone > gross
rejected at service level — schema checks non-negativity; service test via
live curl), barcode format regex `^PRD-[A-Z0-9]{6}$`. Manual gate: create
product, duplicate barcode impossible (unique constraint), void with reason,
scan lookup returns live price, label renders scannable SVG (verify with
phone/scanner), cashier read-only (POST → 403), invalid purity → 404.

## 7. Out of scope

Inventory movements, stock counts, transfers, R2 product images, POS/sales
(`sold` transition), camera scanning, QR codes, old-gold/melting flows.

## 8. Self-review

- No TBD/TODO; barcode alphabet, retry count, status set, role matrix fixed.
- Consistent: per-domain module, batch+audit, paginated lists, branch_id —
  all match Phase 1/2 patterns; `sold` explicitly reserved, not half-built.
- Scoped to single plan: catalog + barcodes only.
- Unambiguous: net formula, barcode format, live-price fallback, label
  rendering library (bwip-js) all explicit.
