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
| POST | /users | users:write | creates user + role + branch member + audit in one batch |
| GET | /users | users:read | paginated |
| PATCH | /users/:id/deactivate | users:write | requires reason; never self; no delete |
| GET | /roles | users:read | roles with permission lists |
| POST | /branches | branches:manage | code unique |
| GET | /branches | auth | scoped to member branches unless branches:manage |
| PATCH | /branches/:id | branches:manage | optional reason audited |
| GET | /settings/:key | auth | |
| PUT | /settings/:key | settings:write | type-checked, audited |
| GET | /audit | audit:read | filterable by entity, entityId; paginated |
| POST | /masters/categories | masters:write | name + code unique |
| GET | /masters/categories | masters:read | paginated |
| PATCH | /masters/categories/:id/deactivate | masters:write | requires reason |
| POST | /masters/purities | masters:write | karat unique, 0 < purity <= 1 |
| GET | /masters/purities | masters:read | paginated |
| PATCH | /masters/purities/:id/deactivate | masters:write | requires reason |
| POST | /gold-rates | masters:write | immutable; UNIQUE(purity, effective_from) |
| GET | /gold-rates/current | masters:read | latest rate per purity |
| GET | /gold-rates | masters:read | history, filterable by karat; paginated |
| POST | /suppliers | masters:write | branch-scoped, NIC unique |
| GET | /suppliers | masters:read | branch-scoped unless branches:manage; paginated |
| PATCH | /suppliers/:id | masters:write | incl. isActive deactivate; optional reason |
| POST | /customers | masters:write | branch-scoped, NIC unique |
| GET | /customers | masters:read | branch-scoped unless branches:manage; paginated |
| PATCH | /customers/:id | masters:write | incl. isActive deactivate; optional reason |
| POST | /products | products:write | auto PRD- barcode; net = gross − stone |
| GET | /products | products:read | filterable by status, categoryId, branchId; paginated |
| GET | /products/:id | products:read | detail + live price (or no_rate) |
| GET | /products/barcode/:code | products:read | scan lookup, case-insensitive |
| GET | /products/:id/label | products:read | Code128 SVG label, image/svg+xml |
| PATCH | /products/:id/void | products:write | reason required; never deletes |
