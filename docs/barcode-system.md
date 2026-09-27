# GoldOS Barcode System

Status: products implemented (Phase 3). Process barcodes (OLD-/MLT-/MFG-/REP-)
reserved for their phases.

## ID formats

- Products: `PRD-` + 6 chars (A–Z sans 0/O/1/I confusion, 2–9), e.g. `PRD-9D3J6S`
- Old-gold lots: `OLD-` (reserved)
- Melting batches: `MLT-` (reserved)
- Manufacturing jobs: `MFG-` (reserved)
- Repairs: `REP-` (reserved)

## Products (implemented)

- Generation: server-side on `POST /products`, DB-checked unique, 5 retries.
- Labels: `GET /products/:id/label` renders Code128 SVG on demand (`bwip-js`,
  Workers-safe) with name, karat, gross/net weights, live price, barcode text.
  No R2 storage. Print via web detail page (print CSS isolates label).
- Lookup: `GET /products/barcode/:code` (case-insensitive) + web scan field
  (`/products/barcode/[code]`); USB/Bluetooth scanners work as keyboard input.
- Every product create/void writes an audit row, so each piece stays traceable.

## Requirements (later phases)

- Camera scanning in the web app (deferred — no dependency yet).
- Every process barcode (old gold, melting, manufacturing, repair) links back
  to its gold-ledger and audit entries so each gram stays traceable.
