# GoldOS API

Base: `/api/v1`. Envelope: `{ success: true, data }` or
`{ success: false, error: { code, message } }`.
Codes: `UNAUTHORIZED, FORBIDDEN, VALIDATION, NOT_FOUND, CONFLICT, INTERNAL`.
Auth: `session` httpOnly Secure cookie; 401 when missing/expired/inactive.

Lists accept `?search=&page=&limit=&sort=` and return `{ rows, total }`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | /health | — | liveness |
| POST | /auth/login | — | Zod-validated, sets cookie, audits |
| POST | /auth/logout | auth | destroys session, audits |
| GET | /auth/me | auth | user + permissions + branchIds |
| POST | /auth/change-password | auth | verifies current; destroys all sessions; relogin |
| POST | /auth/reset-request | users:edit | returns single-use 15-min token once; deliver securely |
| POST | /auth/reset-confirm | — | token + new password; marks used; destroys sessions |
| POST | /users | users:create | role + branchIds[] + audit in one batch |
| GET | /users | users:view | paginated |
| GET | /users/:id | users:view | detail with roles + branchIds |
| PATCH | /users/:id | users:edit | name/branches; role change needs users:approve |
| PATCH | /users/:id/deactivate | users:edit | requires reason; never self |
| PATCH | /users/:id/activate | users:edit | requires reason; never self |
| GET | /roles | users:view | roles with permission lists |
| POST | /branches | branches:create | code unique |
| GET | /branches | branches:view | scoped to member branches unless branches:manage |
| PATCH | /branches/:id | branches:edit | optional reason audited |
| GET | /settings/:key | settings:view | |
| PUT | /settings/:key | settings:edit (settings:manage for branch.* keys) | type-checked, audited |
| GET | /audit | audit:view | filterable by entity, entityId, userId; paginated |
| POST | /masters/categories | masters:create | name + code unique |
| GET | /masters/categories | masters:view | paginated |
| PATCH | /masters/categories/:id/deactivate | masters:cancel | requires reason |
| POST | /masters/purities | masters:create | karat unique, 0 < purity <= 1 |
| GET | /masters/purities | masters:view | paginated |
| PATCH | /masters/purities/:id/deactivate | masters:cancel | requires reason |
| POST | /gold-rates | masters:create | immutable; UNIQUE(purity, effective_from) |
| GET | /gold-rates/current | masters:view | latest rate per purity |
| GET | /gold-rates | masters:view | history, filterable by karat; paginated |
| POST | /suppliers | masters:create | branch-scoped, NIC unique |
| GET | /suppliers | masters:view | branch-scoped unless branches:manage; paginated |
| PATCH | /suppliers/:id | masters:edit | field updates; optional reason |
| PATCH | /suppliers/:id/status | masters:cancel | isActive + reason required |
| POST | /customers | masters:create | branch-scoped, NIC unique |
| GET | /customers | masters:view | branch-scoped unless branches:manage; paginated |
| PATCH | /customers/:id | masters:edit | field updates; optional reason |
| PATCH | /customers/:id/status | masters:cancel | isActive + reason required |
| POST | /products | products:create | auto JW- barcode + SKU; grams/LKR in, mg/cents stored |
| GET | /products | products:view | filters: status, categoryId, purityId, branchId, min/max grams, min/max LKR; paginated |
| GET | /products/:id | products:view | detail + live price in cents (or no_rate) |
| PATCH | /products/:id | products:edit | refs/charges/cost/price/location/notes; weights locked |
| GET | /products/barcode/:code | products:view | scan lookup PRD-/JW-, case-insensitive |
| GET | /products/:id/label | products:view | Code128 SVG label, image/svg+xml |
| POST | /products/:id/images | products:edit | multipart ≤5MB jpeg/png/webp, ≤10 per product → R2 |
| GET | /products/:id/images/:img | products:view | streams image from R2 |
| PATCH | /products/:id/void | products:cancel | reason required; writes VOID movement; never deletes |
| POST | /masters/subcategories | masters:create | requires categoryId |
| GET | /masters/subcategories | masters:view | filterable by categoryId |
| POST | /masters/designs, /product-types, /metal-types, /stone-types | masters:create | name + code unique |
| GET | /masters/designs, /product-types, /metal-types, /stone-types | masters:view | paginated |
| POST | /inventory/movements | products:edit | IN_STOCK→TRANSFER_PENDING/RETURNED/LOST/VOID; locked → 409 |
| GET | /inventory/movements | products:view | filterable by productId, branchId, type |
| GET | /inventory/stock?groupBy= | products:view | branch/purity/product totals (mg + value at current rates) |
| GET | /accounts | accounts:view | chart with balances; optional ?branchId= |
| POST | /accounts/adjustments | accounts:manage | balanced two-leg entry + reason; amounts in cents |
| GET | /customers/:id | masters:view | profile incl. code + notes |
| GET | /customers/:id/ledger | masters:view | opening + journal lines + balance |
| GET | /suppliers/:id | masters:view | profile incl. code + notes |
| GET | /suppliers/:id/ledger | masters:view | opening + journal lines + balance |
| POST | /purchases/orders | purchases:create | draft, no postings |
| GET | /purchases/orders | purchases:view | filters supplier, branch, status |
| GET | /purchases/orders/:id | purchases:view | order + items |
| PATCH | /purchases/orders/:id/cancel | purchases:cancel | DRAFT/SENT only + reason |
| POST | /purchases/orders/:id/receive | purchases:create | full atomic 7-step flow → invoice |
| POST | /purchases/invoices | purchases:create | direct intake, same atomic flow |
| GET | /purchases/invoices | purchases:view | filters supplier, branch, status, date range |
| GET | /purchases/invoices/:id | purchases:view | items + payments + journal |
| POST | /purchases/invoices/:id/payments | purchases:edit | amount ≤ outstanding, cash/bank |
| PATCH | /purchases/invoices/:id/void | purchases:cancel | IN_STOCK items only + reversal + reason |
| GET | /purchases/reports/summary | purchases:view | ?period=today\|month\|all |
| GET | /purchases/reports/breakdown | purchases:view | ?groupBy=supplier\|purity\|category |
| POST | /sales/invoices | sales:create | atomic 14-step flow; split payments; approval over limit |
| GET | /sales/invoices | sales:view | filters customer, branch, status, date range |
| GET | /sales/invoices/:id | sales:view | items + payments + journal + returns |
| POST | /sales/returns | sales:cancel | full/partial/exchange + approval over threshold |
| PATCH | /sales/returns/:id/link | sales:edit | link exchange sale |
| GET | /sales/returns | sales:view | filterable by invoice |
| GET | /sales/reports/summary | sales:view | ?period=today\|month\|all |
| GET | /sales/reports/breakdown | sales:view | ?groupBy=category\|purity\|branch\|salesperson\|payment\|product |
| POST | /oldgold/items | oldgold:create | intake → RECEIVED + OG number |
| GET | /oldgold/items | oldgold:view | filters status, purity, branch, customer, date range |
| GET | /oldgold/items/barcode/:code | oldgold:view | OG- scan lookup |
| GET | /oldgold/items/:id | oldgold:view | full lineage + journal + gold + tests |
| POST | /oldgold/items/:id/tests | oldgold:edit | disagreement needs oldgold:approve approver |
| POST | /oldgold/items/:id/value | oldgold:edit | buy % + deductions + negotiated (reason on overrides) |
| POST | /oldgold/items/:id/purchase | oldgold:edit | atomic 5-ledger batch; remainder → customer payable |
| POST | /oldgold/items/:id/release | oldgold:edit | PURCHASED → AVAILABLE |
| POST | /oldgold/items/:id/convert | oldgold:edit + products:create | creates JW- product, lineage both ways |
| POST | /oldgold/items/:id/files | oldgold:edit | images ≤5MB / docs ≤10MB to R2 |
| GET | /oldgold/items/:id/files/:file | oldgold:view | streams from R2 |
| PATCH | /oldgold/items/:id/void | oldgold:cancel | pre-purchase only + reason |
| GET | /oldgold/reports/summary | oldgold:view | ?period=today\|month\|all |
| GET | /oldgold/reports/breakdown | oldgold:view | ?groupBy=purity\|customer\|branch |
| GET | /oldgold/reports/pending | oldgold:view | PURCHASED/AVAILABLE unmelted |
| GET | /oldgold/customers/:id/history | oldgold:view | items + totals |
| GET | /gold/ledger | gold:view | filters type, branch, ref, product, oldgold, date |
| GET | /gold/lineage | gold:view | ?refEntity=&refId= both directions |
| GET | /gold/stock | gold:view | ?groupBy=purity\|branch\|stage |
| POST | /gold/ledger/adjustments | gold:manage | ADJUSTMENT/LOSS/RECOVERY + reason, threshold approval |
| POST | /melting/batches | gold:manage | branch → DRAFT MELT number |
| GET | /melting/batches | gold:view | filters status, branch |
| GET | /melting/batches/:id | gold:view | inputs + outputs + ledger rows |
| GET | /melting/batches/:id/label | gold:view | Code128 SVG, image/svg+xml |
| POST | /melting/batches/:id/items | gold:manage | AVAILABLE OG- ids → RESERVED |
| POST | /melting/batches/:id/lock | gold:manage | DRAFT → LOCKED |
| POST | /melting/batches/:id/melt | gold:manage | output + assay → difference |
| POST | /melting/batches/:id/approve | gold:manage | reason always; threshold approval; posts ledger |
| PATCH | /melting/batches/:id/void | gold:manage | DRAFT only + reason |
