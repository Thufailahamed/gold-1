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
