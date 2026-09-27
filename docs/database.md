# GoldOS Database

Engine: Cloudflare D1 (SQLite). Migrations: sequential SQL in
`apps/api/drizzle/`, never edit an applied migration. Drizzle schema in
`apps/api/src/db/schema.ts` mirrors the SQL.

## Phase-1 tables (migration `0001_core`)

- `users(id, email UNIQUE, name, password_hash, is_active, created_at, updated_at, created_by)`
- `roles(id, name UNIQUE)` — admin, manager, cashier, viewer
- `permissions(id, name UNIQUE)` — users:read, users:write, branches:manage,
  settings:write, audit:read
- `role_permissions(role_id, permission_id)` — composite PK
- `user_roles(user_id, role_id)` — composite PK
- `branches(id, name, code UNIQUE, address, is_active, created_at, created_by)`
- `branch_members(user_id, branch_id)` — composite PK
- `sessions(id, user_id, expires_at, created_at)` — 12h idle, 7d absolute
- `audit_logs(id, user_id, action, entity, entity_id, prev_json, new_json,
  reason, ip, branch_id, created_at)` — append-only, indexed on (entity, entity_id)
- `settings(key PK, value_json, type)` — string | number | boolean | json
- `idempotency_keys(key PK, created_at)` — reserved for Phase-2 money/gold writes

Conventions: `id TEXT PK` (UUID), timestamps as INTEGER millis, FKs enforced.

## Phase-2 reservations (not yet created)

- Gold ledger: gross/stone/net weight, purity, karat, fine-gold equiv, rate,
  source → destination, wastage, recovery, loss. Every row carries `branch_id`.
- Financial ledger: revenue, COGS, cash, bank, receivables, payables, payments,
  refunds, adjustments. Every sale/purchase auto-posts entries in the same batch.
- All business tables carry `branch_id`; inventory/cash are branch-scoped.
