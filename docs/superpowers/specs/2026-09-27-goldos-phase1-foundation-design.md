# GoldOS — Phase 1 Foundation Design

Date: 2026-09-27
Status: Approved
Scope: Foundation only (no POS / inventory / masters business logic)

## 1. Context

Greenfield repo at `gold-1/` (empty, no git, no code). No architectural conflicts.
Brand: **GoldOS** — jewellery ERP for Sri Lankan gold businesses.
Central principle: every gram of gold and every rupee traceable via dual ledgers.

Full 34-module scope decomposed. This spec covers Phase 1 foundation only so
Phase 2+ (masters → inventory/barcode → gold ledger → sales/purchases) plugs in
without rewrites.

Decisions (user-confirmed):
- Phase 1: foundation only (auth, users, roles, branches, settings, audit,
  dashboard shell, design system, DB + API + docs foundation).
- Monorepo: Turborepo-style `apps/web` + `apps/api` + `packages/shared`.
- Auth: D1-backed sessions + httpOnly Secure cookies, scrypt hashing.
- Cloudflare D1/R2/Workers already provisioned; wire real bindings, local
  Wrangler dev supported.

## 2. Architecture

```
gold-1/
  apps/web/            Next.js 19 App Router, TS strict, Tailwind, shadcn/ui,
                       RHF + Zod, TanStack Query
  apps/api/            Hono on Cloudflare Workers, /api/v1/<domain> routers,
                       Drizzle ORM → D1, R2 client (stubbed Phase 1)
    drizzle/           sequential SQL migrations (never edit applied ones)
    src/
      routes/          auth, users, roles, branches, settings, audit, health
      middleware/      auth, requirePerm, audit, error, branch-scope
      services/        user-service, branch-service, settings-service, audit-service
      db/              schema, client, transactions
  packages/shared/     Zod schemas, permission constants, API types,
                       { success, data, error } envelope
  docs/                architecture, database, business-rules, gold-accounting,
                       api, permissions, deployment, barcode-system
```

API flow:
UI (RHF+Zod client) → Hono (Zod server → requireAuth → requirePerm →
branch-scope → service → D1 batch/transaction → audit write) → typed
response → TanStack Query cache.

Error envelope: `{ success: false, error: { code, message } }` with codes
`UNAUTHORIZED, FORBIDDEN, VALIDATION, NOT_FOUND, CONFLICT, INTERNAL`.
Central `onError`, no stack leaks, sonner toasts on web.

## 3. Components

- **auth**: login/logout/me, session create/destroy, activation flags.
- **users**: CRUD, activate/deactivate (no hard delete), assign roles/branches.
- **roles/permissions**: `roles, permissions, role_permissions, user_roles`.
  Seed: `admin, manager, cashier, viewer`. Permissions e.g.
  `users:read, users:write, branches:manage, settings:write, audit:read`.
- **branches**: CRUD, `branch_members(user_id, branch_id, role)`, branch
  switcher in UI, `branchId` on all future business tables.
- **settings**: typed key-value (`key, value_json, type`); gold rates, purity,
  making-charge, wastage, discount limits live here later — never hardcoded.
- **audit**: `audit_logs` append-only (no UPDATE/DELETE grants), fields:
  user, action, entity, entity_id, prev_json, new_json, reason, ip, device,
  branch_id, timestamp. Written in same D1 batch as mutation.
- **web shell**: login page, sidebar layout, dashboard placeholders
  (cash / gold / stock cards → stub data), shadcn theme, neutral + gold
  accent `#C9A227`, Inter, dense tables, empty/loading/error states,
  skeletons, responsive + keyboard-friendly.
- **docs**: all 8 required files skeletoned in Phase 1, filled as built.

## 4. Data model (Phase 1 tables)

`users, roles, permissions, role_permissions, user_roles, branches,
branch_members, sessions (D1, 12h idle / 7d absolute), audit_logs,
settings, idempotency_keys`.

Conventions: `id TEXT PK (nanoid/uuid)`, `created_at, updated_at INTEGER`,
`created_by FK users`, FKs enforced, indexes on `(branch_id)`,
`(user_id)`, `(entity, entity_id)`, `(created_at)`.

Future ledgers (schemed in `database.md`, tables deferred):
- Gold ledger: gross/stone/net weight, purity, karat, fine-gold equiv, rate,
  source → destination, wastage, recovery, loss.
- Financial ledger: revenue, COGS, cash, bank, receivables, payables,
  payments, refunds, adjustments. Every sale/purchase auto-posts entries.

Integrity rules carried forward: D1 batch transactions; VOID/CANCEL/REVERSE
with user+timestamp+reason(+approval), never hard-delete business records.

## 5. Data flow example (Phase 1 template for future sales)

Create-user: validate → requireAuth+`users:write` → hash (scrypt) →
D1 batch [insert user, insert user_roles, insert audit_logs] →
201 `{success:true, data:user}`. Any step fails → full rollback, error
envelope, no partial user.

## 6. Error handling

Server Zod validation on every route; client mirrors via shared schemas.
401 → login redirect; 403 → denied UI; 409 → conflict message; 500 →
generic message + logged. Audit write failure fails the mutation (no
silent success without trace).

## 7. Testing

Vitest: hashing, permission checks, audit payload builder, settings typing.
Manual gate: login/logout, expired session, RBAC deny, branch switch
isolation, deactivate user, audit row present, validation errors.
`verification-before-completion` skill before claiming done.

## 8. Out of scope (Phase 2+)

Products, categories, purities, gold rates, barcodes, inventory, customers,
suppliers, POS/sales, purchases, old gold, testing, melting, manufacturing,
repairs, orders, cash/bank/expenses, ledgers, closings, reports, transfers,
approvals, notifications, R2 uploads, camera scanning.

## 9. Self-review

- No TBD/TODO placeholders; brand fixed as GoldOS.
- Consistent: Turborepo + Hono + D1 sessions matches user picks.
- Scoped to single plan: foundation only, ledgers schemed not built.
- Unambiguous: table list, expiry times, accent color, error codes fixed.
