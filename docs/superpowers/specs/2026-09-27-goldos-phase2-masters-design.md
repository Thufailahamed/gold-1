# GoldOS — Phase 2 Masters Design

Date: 2026-09-27
Status: Approved
Scope: 5 master domains only — categories, purities, gold rates, suppliers,
customers. No products, inventory, ledgers, or POS.

## 1. Context

Phase 1 (foundation: auth/RBAC, users, branches, settings, audit, web shell)
is complete on `main`. Phase 2 was decomposed; this spec covers the masters
slice — the data every downstream module (products, inventory, gold ledger,
purchases, sales) will FK to. Approach: dedicated module per master (option A),
following Phase-1 conventions exactly (shared Zod, services own D1, atomic
batch + audit, paginated lists). Generic-framework (B) and settings-table (C)
approaches rejected: B breaks per-domain module convention, C cannot support
future foreign keys or per-row audit.

Decisions (user-confirmed):
- Core 5 masters only; no expense categories, payment methods, or stone types.
- Gold rates: daily per-karat rows with effective-from dating and full history.
- Purities carry karat + decimal purity + default making-charge + wastage %.
- Suppliers/customers: full profile (NIC, credit limit, opening balance),
  branch-scoped; ledgers deferred.

## 2. Data model (migration 0002_masters, never edit 0001)

- `categories(id TEXT PK, name UNIQUE, code UNIQUE, description, is_active
  DEFAULT 1, branch_id NULL = global, created_at, created_by FK users)`
- `purities(id TEXT PK, karat UNIQUE e.g. '22K', purity REAL e.g. 0.916,
  default_making_charge REAL DEFAULT 0, default_wastage_pct REAL DEFAULT 0,
  is_active DEFAULT 1, created_at)`
- `gold_rates(id TEXT PK, purity_id FK purities, rate_per_gram REAL,
  effective_from INTEGER, created_at, created_by FK users)`,
  UNIQUE(purity_id, effective_from). Immutable: no UPDATE/DELETE; new rate =
  new row. Current rate per purity = MAX(effective_from) <= now.
- `suppliers`, `customers(id TEXT PK, name, phone, address, nic UNIQUE
  NULLABLE, credit_limit REAL DEFAULT 0, opening_balance REAL DEFAULT 0,
  is_active DEFAULT 1, branch_id FK branches, created_at, created_by FK users)`
- Seed in migration: purities 24K (1.0), 22K (0.916), 21K (0.875), 18K (0.750);
  categories Ring, Chain, Bangle, Earring, Pendant, Necklace.
- All writes audited; deactivation requires reason; no hard deletes.

## 3. API + permissions

Routers: `GET/POST /categories`, `GET/POST /purities` (+ `PATCH
/purities/:id/deactivate`), `GET/POST /gold-rates` (POST only creates;
no PATCH/DELETE), `GET /gold-rates/current` (latest per purity),
`GET/POST/PATCH /suppliers`, `GET/POST/PATCH /customers`.
Lists: `?search=&page=&limit=` returning `{ rows, total }`.
Shared schemas in `packages/shared`: `createCategorySchema`,
`createPuritySchema`, `createGoldRateSchema`, `createPartySchema` (suppliers +
customers share it; NIC optional, credit_limit/opening_balance >= 0).
New permissions `masters:read`, `masters:write`: admin + manager get both,
cashier gets read, viewer none. Every write batches business row + audit_logs;
error envelope and codes unchanged from Phase 1.

## 4. Web UI

Five `(app)` pages: Categories, Purities, Gold Rates, Suppliers, Customers.
Each: dense searchable paginated table + RHF+Zod create dialog + deactivate
with reason + empty/skeleton/error states + sonner toasts, reusing Phase-1
styling and gold accent. Gold Rates page: "current rates" strip (latest per
karat) over history table; new-rate dialog (karat select + rate + effective
from). Sidebar links gated by `masters:read`. TanStack Query introduced for
list caching. Dashboard placeholders untouched (still Phase-3+).

## 5. Data flow example

Create gold rate: validate `createGoldRateSchema` → requireAuth +
`masters:write` → check purity exists/active → D1 batch [INSERT gold_rates,
INSERT audit_logs] → 201. Maior rule: rate write without audit row fails whole
batch; history rows never mutated.

## 6. Testing

Vitest: party schema (negative credit rejected), rate schema (rate > 0,
effective_from required), purity decimal range (0 < p <= 1). Manual gate:
CRUD each master, duplicate code/karat → 409, rate immutability (no PATCH
route → 404), cashier read-only (POST → 403), audit rows present, current
endpoint returns one row per purity.

## 7. Out of scope

Products, barcodes, inventory, gold/financial ledgers, purchases, sales, POS,
cash/bank, R2 uploads. Dashboard cards stay stubbed.

## 8. Self-review

- No TBD/TODO; seed values, permissions matrix, endpoint list explicit.
- Consistent: per-domain modules match Phase-1 architecture; batch+audit
  pattern reused; branch_id present where branch-scoped (suppliers/customers),
  absent where global (purities, rates).
- Scoped to single plan: 5 masters, no downstream logic.
- Unambiguous: immutability rule, current-rate definition, shared party
  schema, role matrix all fixed.
