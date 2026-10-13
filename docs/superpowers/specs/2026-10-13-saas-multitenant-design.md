# Sellable Multi-Tenant SaaS for GoldOS — Design

Date: 2026-10-13
Status: APPROVED + REVISED (owner approved; architecture switched 2026-10-13
from 8-shop bindings fleet to automatic D1-per-shop — unlimited shops)

## 1. Intent / why

GoldOS today is a single-shop ERP with a staff-only control plane (tenants,
subscriptions, invoices, flags, support). The operator can create accounts
manually, but a shop cannot sign up, get its own isolated workspace, trial,
and pay — and one deployment serves one shop (`TENANT_ID` pin).

Goal: sell to many independent jewellery shops from one domain and one
codebase. Owner decisions (2026-10-13):
- Payments: bank transfer + receipt upload, admin reviews and approves.
  payments.lk gateway later, kept extensible.
- Signup: BOTH self-serve public signup AND admin-created accounts.
- Access: single domain (e.g. app.goldos.lk) with shop picker on login.
  No per-shop subdomains, no custom domains in v1.
- Trial: 14 days, then pay or suspend.

Success = owner can publish pricing, a shop signs up in <3 min, gets an
isolated workspace with seeded owner + branch, uses all 21 modules for 14
days, uploads a bank slip, admin approves, subscription goes ACTIVE, and a
second shop's data is never visible to the first.

## 2. Goals / non-goals / anti-goals

Goals:
- G1 Public signup → auto-provision isolated shop DB + owner user, TRIALING 14d.
- G2 Admin create-account flow stays, same provisioning path.
- G3 Single-domain login with shop picker (email may own/join N shops).
- G4 Per-request tenant isolation (no `TENANT_ID` env pin per deploy).
- G5 Bank-transfer billing: invoice → slip upload (R2) → admin approve/reject →
  ACTIVE / PAST_DUE / BILLING-suspend per existing billing_cycle rules.
- G6 Plan limits + tenantGate keep working per-request (not per-worker).
- G7 Trial-expiry, dunning display, support tickets per shop unchanged.
- G8 Upgrade/downgrade plans self-serve (manual invoice true-up as today).

Non-goals (v1):
- No Stripe/PayHere auto-charge. Manual only + `method=ONLINE` reserved.
- No per-shop subdomain/custom-domain routing.
- No central SSO / Google login. Passwords stay per-shop (scrypt).
- No cross-shop analytics for shop users. No storage metering (R2 stays 0).
- No auto-delete of shop D1 on purge (export + manual delete, audit kept).

Anti-goals (failure even if it works):
- One shop seeing another's sales, gold ledger, or users.
- Signup creating an account that staff cannot suspend/impersonate/bill.
- Two deploys diverging (managed vs unmanaged forks).

## 3. Constraints (builder must respect)

- Stack: Cloudflare Workers + Hono API (`apps/api`), D1 (SQLite) x2 planes,
  R2 for slips, Next.js web (`apps/web`), Drizzle, shared zod schemas
  (`packages/shared/src/platform.ts`). No new infra vendor.
- Shop schema has NO `tenant_id` column (69 tables). Isolation stays
  database-per-shop, not row-per-shop — verified 2026-10-13 that shared
  tables would mean scoping 1,033 raw-SQL sites with leak risk. Rejected.
- One Worker serves ALL shops (no per-shop deploy). Each shop gets its own
  D1, created automatically at signup via the Cloudflare D1 REST API and
  reached at request time over HTTPS (not wrangler bindings — bindings need a
  redeploy per shop and cap the fleet). Verified 2026-10-13: no per-database
  fee, 1M databases on $5/mo Workers Paid, D1 designed for per-tenant DBs.
  Secrets (never in repo): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_API_TOKEN`
  (`wrangler secret put`). Pricing partition: Free plan caps at 10 databases —
  selling needs Workers Paid.
- Shop migrations (`drizzle/*.sql`, 43 files) are bundled into the Worker at
  build time (`scripts/bundle-migrations.mjs` → committed
  `apps/api/src/db/shop-migrations.ts`; re-run when `drizzle/*` changes) so
  in-worker provisioning can apply them over REST. Chart of accounts + default
  settings come from migrations 0008/0015/0018/0031/0032 — verified.
- Existing control-plane tables (`tenants`, `subscriptions`, `invoices`,
  `payments`, `impersonation_grants`, `support_*`, `platform_*`) are append-only
  where noted. Reuse `subscription_events`, `platform_audit_logs`.
- Auth today: opaque session id in shop DB, cookie `session` + `X-Session-Id`,
  12h idle / 7d absolute. Platform staff separate (`psession`, Path=/platform).
  Keep both; do not merge.
- Web has NO `middleware.ts`; auth is client-side `useSession`. Keep that
  pattern; add tenant cookie, not server middleware.

## 4. Architecture (what changes)

### 4.1 Today
`TENANT_ID` env → `tenantGate` + `currentPlan` → `env.DB` (one shop).
`tenants.data_plane` is only used for usage snapshots.

### 4.2 v1 SaaS (single domain, auto D1-per-shop, per-request tenant)

```
browser (app.<domain>)
 ├─ GET /signup, /login (shop picker), /billing (pay), /support
 └─ /platform/* (staff console, unchanged)
        │
API worker (one deploy: PLATFORM_DB + legacy DB bound; shop DBs via D1 REST)
 ├─ POST /api/v1/public/signup        (rate-limited → tenant TRIALING + auto D1)
 ├─ GET  /api/v1/public/plans         (public plans + prices)
 ├─ POST /api/v1/auth/lookup          {email} → [{slug,name}] (central index)
 ├─ POST /api/v1/auth/login           {email,password,slug} → session @ shop D1
 ├─ *Authenticated* — middleware chain per request:
 │    resolveTenant (cookie goldos_tenant + session) → tenant row → D1 REST handle
 │    → tenantGate (PLATFORM_DB status, 30s cache per tenant)
 │    → requireAuth (against that shop's D1) → requirePerm / branchScope (unchanged)
 ├─ POST /api/v1/billing/slip         (auth, R2 upload, creates payment PENDING)
 └─ /platform/v1/*                    (staff, unchanged + approve/reject slip)
```

Tenant resolution (builder detail):
- New cookies: `goldos_tenant=<slug>; Path=/; 30d`. Login sets it.
  Every authenticated call reads it first; fallback `X-Shop-Slug` header.
  Session cookie stays `session; Path=/; HttpOnly; Secure` with
  `SameSite=None` in production (cross-site app+api, see §8 O1) and `Lax`
  on localhost. `goldos_tenant` picker cookie is readable by JS (no HttpOnly).
  If the session id is not found in the resolved tenant's D1 → 401, never
  try other D1s (prevents cross-shop session replay). Logout clears both cookies.
- New PLATFORM_DB tables (migration `0002_saas.sql`):
  `tenant_databases (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  d1_id TEXT NOT NULL UNIQUE, d1_name TEXT NOT NULL, created_at INTEGER NOT NULL)`;
  `tenant_members (tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, email))` — central login index so `lookup` never
  fans out to N databases. `tenants.data_plane` keeps the D1 id as a readable
  mirror (cron/docs), not a binding name.
- New `apps/api/src/db/rest-d1.ts`: `RestD1` class implementing the D1 surface
  the codebase uses (`prepare().bind().first/all/run`, `batch()`) over
  `POST /accounts/{acct}/d1/database/{id}/query`. Handles cached per isolate
  (tenant → handle). Tests inject in-memory handles — no network in tests.
- New helper `resolveShopDb(env, slugOrId): {db, tenant}` — tenant row lookup
  (ACTIVE/SUSPENDED, not ARCHIVED for login), then handle for its `d1_id`,
  or 503 `PROVISIONING` while provisioning runs.
- `tenantGate` and `enforcePlanLimit` change signature from `env.TENANT_ID` to
  `c.get('tenantId')` set by `resolveTenant`. Keep unmanaged passthrough when
  `!PLATFORM_DB` (local single-shop dev) and legacy-pin fallback when
  `TENANT_ID` is set (old deploys + existing tests keep passing).
- Sessions stay in shop D1 (no migration). `lookup` reads `tenant_members`
  only (20/min/IP, slugs only, same-latency empty for unknown). Login auths
  against exactly one D1 — timing-safe as today.
- Perf (accepted for v1, my call): each query is one HTTPS roundtrip. No
  per-page optimisation in v1; Phase B coalesces hot paths. Correctness first.

### 4.3 Provisioning (the sellable path — fully automatic, in-worker)

Public signup input (zod, shared): `{shopName, slug^[a-z0-9-]{3,30}$,
ownerName, ownerEmail, password>=10 chars, phone?, country=LK, currency=LKR,
timezone, planId, interval}`.

Flow (all inside the API worker, seconds):
1. Validate `signup_enabled`, plan public/active, slug not blocklisted/taken.
   Same email may own N shops (different passwords per shop — picker explains).
2. `createTenant` (existing) with `trialDays=14` → TRIALING, tenant ACTIVE.
   Record `job_runs` row `job='provision' status='RUNNING'`.
3. Create D1 `goldos-<slug>-<shortid>` via REST (`POST /accounts/{acct}/d1/database`
   with the token secret). On name clash, retry with new shortid.
4. Apply bundled `shop-migrations.ts` (43 files, in order) to the new D1 via
   REST batch/query. Then seed via existing `buildSeedSql` (roles/permissions/
   owner + HQ branch; chart/settings come from migrations) with scrypt hash
   from `services/hash.ts`.
5. Write `tenant_databases` + `tenant_members(owner)` + mirror D1 id into
   `tenants.data_plane`; mark `job_runs` OK.
6. Return `{slug, loginUrl: /login?shop=<slug>}` + auto-login as owner (set
   `goldos_tenant` + `session` cookies).

Failure (my call): any step failing marks the job FAILED + `tenant_notes`
entry; the slug stays reserved for 24h (prevents land-grab confusion) and
staff Retry re-runs from scratch — destroy the half-made D1 via API and start
over (D1 creation is seconds; migrations are not idempotent so resume is
unsafe). Until `tenant_databases` exists the API returns 503 `PROVISIONING`.

No fleet cap (my call): bindings are gone; the only ceiling is Cloudflare's
1M databases per account. No `FLEET_FULL`, no redeploy per shop.

Rate limits (my call, no new infra): D1-backed throttling (same pattern as
`login_attempts`) + in-memory cache like `gateCache`. Signup 5/hr/IP, lookup
20/min/IP. No KV/DO in v1.

DB plumbing scope (my call): new `getShopDb(c)` helper replaces every
`getDb(c.env)` / direct `c.env.DB` read in AUTHENTICATED shop routes,
`tenantGate`, `currentPlan`, `enforcePlanLimit`, `platformBridge`, support,
impersonation, audit. Query code itself is UNTOUCHED — it just receives a
REST-backed handle instead of a bound one. Legacy `env.DB` is used ONLY when
`!PLATFORM_DB` (unmanaged local dev) or legacy `TENANT_ID` pin (old deploys).
Crons iterate `tenant_databases` via REST (rewrite `collectAllUsage`;
`resolveDataPlane` binding logic retired).

Admin create: same in-worker path, extra staff picker for
plan/interval/trialDays, checkbox "send invite" (v1: show temp password once;
no email sender yet).

`tenant_members` upkeep (my call): signup + staff user-create/activate write
index rows; deactivate/delete remove them. Best-effort convenience for the
picker — login with explicit slug never needs the index. Documented
eventual-consistency: a user added 60s ago may need direct `?shop=` link
(cache TTL); acceptable v1.

Existing single shop adoption (doc-only): create its tenant row via admin
console, insert `tenant_databases` pointing at the current D1 id, add owner
to `tenant_members`. Zero data migration.

Seed scope (builder, verified against repo): reuse existing `buildSeedSql`
from `apps/api/src/seed.ts` — roles/permissions/owner/HQ branch. Chart of
accounts + default settings come from the 43 `drizzle/*.sql` migrations, not
from seed code. Gold board starts empty (owner publishes first rate). Nothing else.
R2 (my call): shared `goldos-assets` bucket stays private; slips at
`receipts/<tenantId>/<receiptId>` ≤5MB png/jpg/pdf enforced in Worker;
staff download via authed proxy route checking `p.billing:view`; shop lists
only own tenant's receipts; retained until tenant purge (manual D1 delete).

### 4.4 Billing — bank transfer + approve (no gateway in v1)

- Invoices already generated by `billing_cycle` (trial end → first invoice,
  renewals, PAST_DUE, auto-suspend). No change.
- New: `tenant_receipts (id, tenant_id, invoice_id, r2_key, amount_cents,
  bank_ref, reject_reason TEXT NULL, uploaded_by, status PENDING|APPROVED|REJECTED,
  created_at, reviewed_at, reviewed_by)` in PLATFORM_DB (migration `0002_saas.sql`).
  Shop picks ONE invoice per upload (default oldest OPEN); v1 requires full-amount
  match (partial payments rejected with message — my call). Approve calls existing
  `recordPayment` once; Reject stores `reject_reason` + audit, tenant can re-upload.
- Shop: `/billing` page shows open invoices + trial clock (from existing
  `/platform/context`), upload form → `POST /billing/slip` (multipart, 5MB
  png/jpg/pdf → R2 `receipts/<tenant>/<id>`).
- Staff: Billing → receipts queue → Approve (calls existing `recordPayment`
  + marks invoice PAID, clears PAST_DUE/BILLING-suspend per existing rules)
  or Reject (reason → tenant sees it, can re-upload). Every action writes
  `platform_audit_logs`.
- `payments.lk` reserve: `payments.method` already has `ONLINE`; add
  `payment_ref` free text. When gateway lands, only `services/billing.ts` +
  webhook route change.

### 4.5 Web changes (single domain)

- `/` (marketing, existing premium page): change CTAs from `/login` to
  `/signup` + `/login`; add `#pricing` section rendering `GET /public/plans`
  (name, LKR monthly/yearly, limits, trial badge). Keep design system.
- New `/signup` (public): 3-step (shop → owner → plan) → calls signup →
  success screen with shop slug + Go to login. Honeypot + 5/hr/IP throttle.
- `/login` rework: email field → `lookup` → shop picker (radio list, default
  `?shop=` or `goldos_tenant` cookie) → password → login. Error copy must not
  reveal which emails exist (generic "check email, shop and password").
- `(app)/layout.tsx`: after `useSession`, also fetch `platform/context`; if
  `managed && subscription TRIALING` show trial banner with days left + Pay
  button; if `TENANT_SUSPENDED/ARCHIVED` show blocked screen with support
  email (instead of silent fail). Branch switcher unchanged.
- New `(app)/billing` + `(app)/support` (support exists? keep, wire receipts).
- Platform console: Tenants detail gets Provisioning card (D1 id/name,
  retry provision, impersonate), Billing gets Receipts queue. No new staff roles.

### 4.6 Security / isolation checklist (builder must implement + test)

- Every shop query uses the resolved per-request D1 handle. No global `env.DB`
  fallback when managed. Tests assert cross-tenant read returns 401/404.
- `lookup` returns slugs only, rate-limited 20/min/IP, no password oracle.
- Signup rate-limit 5/hr/IP + slug blocklist (`admin,api,platform,support`).
- Receipts: R2 key prefixed by tenant id; staff download via signed proxy that
  checks `p.billing:view`; shop can only list own tenant's receipts.
- Impersonation already single-use + 1h cap; extend check from `TENANT_ID ==
  grant.tenant` to `resolved tenant == grant.tenant`.
- `purgeTenant` stays control-plane only; shop D1 delete is one API call
  (console button does it — no wrangler needed).

## 5. Phased build (sizes)

- Phase A (sellable MVP, this plan): auto signup + in-worker provision +
  login picker + per-request tenant resolve + receipts billing + marketing
  pricing + trial banners. Unlimited shops, one deploy.
- Phase B (later): hot-path query coalescing (REST latency), payments.lk
  webhook, email (invite, dunning, receipts), custom domains, storage
  metering, self-serve plan change with proration.

## 6. Test plan (builder)

- `platform.provision.test.ts`: signup → tenant TRIALING 14d → D1 created +
  migrations applied + owner seeded → owner can login → second signup slug
  clash 409 (all with mocked Cloudflare API).
- `multitenant.isolation.test.ts`: shop A session cannot read shop B (resolve
  with forged `goldos_tenant` → 401/404); suspended tenant → 403
  TENANT_SUSPENDED; archived → 403.
- `billing.receipt.test.ts`: upload → PENDING → approve → invoice PAID +
  PAST_DUE cleared; reject → can re-upload.
- `login.lookup.test.ts`: unknown email returns [] with same latency bucket;
  known email returns slugs without names leaking other tenants.
- Manual: two shops in two browsers, branch switch, POS sale, day close —
  no crossover in reports/audit.

## 7. Open calls made by this design (no user question needed)

- No bindings, no fleet cap: the only ceiling is Cloudflare's 1M databases.
- Passwords per-shop (isolation by construction). Same email may own N shops
  with different passwords — picker explains this.
- Receipts table in PLATFORM_DB (not shop DB) so billing survives shop archive.
- Provision retry = destroy + recreate (migrations aren't idempotent).
- No email sending in v1 — credentials/invoices shown in UI + staff copy-paste.

---
Approval: reply "approved" to hand to planner (`writing-plans` → implementation
plan + todos). Minor builder-settled details are marked above.

## 8. Open — needs owner answer (from builder check)

- O1 Domains: ANSWERED 2026-10-13 — separate `app.*` (web) + `api.*` (API).
  Consequences locked in: `WEB_ORIGIN=https://app.<domain>,http://localhost:3000`,
  CORS `Allow-Credentials:true` (already in `middleware/cors.ts`), cookies
  `session` + `goldos_tenant` MUST be `SameSite=None; Secure; HttpOnly`
  (session) / `SameSite=None; Secure` (tenant picker, readable by JS).
  Localhost stays `Lax` via existing dev fallback. CSRF middleware already
  validates Origin/Referer against `WEB_ORIGIN` — no change needed.
- O2 Fleet: SUPERSEDED 2026-10-13 — no fleet. Owner confirmed unlimited-shop
  goal; automatic D1-per-shop replaces bindings. Workers Paid ($5/mo) required
  past 10 databases; usage fits included limits until large.
