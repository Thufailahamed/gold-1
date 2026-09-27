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
