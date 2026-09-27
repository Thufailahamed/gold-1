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
| POST | /products | products:create | auto PRD- barcode; net = gross − stone |
| GET | /products | products:view | filterable by status, categoryId, branchId; paginated |
| GET | /products/:id | products:view | detail + live price (or no_rate) |
| GET | /products/barcode/:code | products:view | scan lookup, case-insensitive |
| GET | /products/:id/label | products:view | Code128 SVG label, image/svg+xml |
| PATCH | /products/:id/void | products:cancel | reason required; never deletes |
