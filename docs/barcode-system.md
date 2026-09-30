# GoldOS Barcode System

Status: products implemented (Phase 3), including camera scanning and batch
labels. Old-gold items (`OG-`) are scannable from the header and scan page.
Melting (`MELT-`) and manufacturing (`MO-`) numbers are document numbers, not
scanned tags.

## ID formats

- Products: `JW-` + 6 chars (A–Z sans 0/O/1/I confusion, 2–9), e.g. `JW-M2Q39H`. Legacy `PRD-` codes grandfathered — lookup accepts both.
- SKU: `SKU-` + 6 chars, unique per piece (internal/stock use). Also scannable.
- Old-gold items: `OG-` + 6 digits.
- Melting batches: `MELT-` + 6 digits; melt lots `MLT-…`.
- Manufacturing orders: `MO-` + 6 digits.
- Sales invoices: `SINV-` + 4+ digits, printed as a Code128 barcode on every bill.

Product barcode regex: `^(PRD|JW)-[A-Z0-9]{6}$` (`BARCODE_RE`, `@goldos/shared`).

## Normalisation

All scanner input goes through `normalizeCode` (`@goldos/shared`): strips
whitespace and control characters (CR/LF/Tab suffixes, GS1 `\x1d`) and
uppercases. Codes are stored uppercase (guaranteed by migration 0034), so
lookups match with plain equality against the unique `barcode`/`sku` indexes.
Used by product lookup, stock-count scans and transfer receiving.

## Products

- Generation: server-side on `POST /products`, DB-checked unique, 5 retries.
- Labels: `GET /products/:id/label` renders a Code128 SVG on demand (`bwip-js`,
  Workers-safe) with name, karat, gross/net weights, price and the code as
  text. The symbol is scaled by its own viewBox with padded quiet zones
  so it is never clipped. The price is what the till charges: the
  selling-price override when set, else the live-rate price. Served
  `Cache-Control: no-store`. No R2 storage.
- Printing: single piece from the detail page (`/products/:id/print`, 1–50
  copies); batches via `/products/labels?ids=a,b,c` (1–10 copies each),
  linked from purchase invoices and manufacturing orders. Print CSS isolates
  labels and keeps each one on a single page.
- Lookup: `GET /products/barcode/:code` matches barcode or SKU. Web:
  header scan field (`/` to focus) and `/scan` route `OG-` codes to the
  old-gold lookup and everything else to `/products/barcode/[code]`.
- Scanners: USB/Bluetooth scanners work as keyboard input everywhere. Camera
  scanning uses the browser's native `BarcodeDetector` (no dependency) on the
  scan page, the full scan field and POS; the button only appears where the
  browser supports Code128 detection (Chrome on Android/macOS/ChromeOS).
- POS rejects a scan at the counter when the piece is not `IN_STOCK`, is in
  another branch, has no book cost, or has no price — the same checks
  checkout enforces. A tag already in the cart is refused before the lookup.
- Every product create/void writes an audit row, so each piece stays traceable.

## Billing (POS → invoice → return)

- Shelf price is enforced: `POST /sales/invoices` refuses (409) any line whose
  price is not the current shelf price (override, else live rate). The POS
  then offers "Refresh prices". Price cuts go through discounts and their
  approval limits. Custom-order delivery calls the service directly with the
  agreed price and is not subject to this.
- A piece listed twice in one sale is refused.
- Discount approvals: a PENDING (202) response keeps its `approvalId` in the
  POS; once approved, Complete sale retries with it. Any cart edit drops it.
  Counter approvers are chosen by name (`GET /sales/approvers`).
- Hand-offs: `/pos?add=<tag>` (Sell at POS on the scan and product pages);
  `/pos?exchange=<returnId>…` starts the replacement sale of an EXCHANGE
  return, linked through `exchangeReturnId` in the same batch.
- The cart, customer and exchange survive a page refresh (sessionStorage draft).
- Print: `/sales/invoices/:id/print` (full bill) or `?format=receipt` (80mm
  thermal). Both carry `GET /sales/invoices/:id/barcode` (Code128 SVG).
- Lookup: `GET /sales/lookup/:code` resolves a `SINV-` number, or a product
  tag/SKU to the latest sale of that piece. The header scan field, `/scan` and
  the Returns page route there. In the return form, scanning a piece ticks its
  line, and lines already returned are hidden.
