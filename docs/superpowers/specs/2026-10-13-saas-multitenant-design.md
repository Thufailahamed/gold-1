# Sellable Multi-Tenant SaaS for GoldOS — Design

Date: 2026-10-13
Status: DRAFT — awaiting owner approval (nothing built until approved)

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
- Shop schema has NO `tenant_id` column (69 tables). Do NOT add tenant_id to
  every table in v1 — isolation is database-per-shop, not row-per-shop.
- Cloudflare Workers cannot dynamically bind D1 at runtime. Single worker can
  only reach D1s listed in `wrangler.toml`. So v1 supports a bounded fleet
  (e.g. 10–20 bindings `DB_T1..DB_TN`) + a provisioning script that creates
  the D1 via API, runs the 43 migrations, seeds, and assigns the binding.
  Design must not promise unbounded auto-D1 without a deploy.
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

### 4.2 v1 SaaS (single domain, DB-per-shop, per-request tenant)

```
browser (app.goldos.lk)
 ├─ GET /signup, /login (shop picker), /billing (pay), /support
 └─ /platform/* (staff console, unchanged)
        │
API worker (one deploy, PLATFORM_DB bound, DB_T1..DB_TN + legacy DB bound)
 ├─ POST /api/v1/public/signup        (rate-limited, captcha-ready)
 ├─ GET  /api/v1/public/plans         (public plans + prices)
 ├─ POST /api/v1/auth/lookup          {email} → [{slug,name}] (no password leak)
 ├─ POST /api/v1/auth/login           {email,password,slug} → session @ correct D1
 ├─ *Authenticated* — middleware chain per request:
 │    resolveTenant (cookie goldos_tenant + session) → pick D1 binding
 │    → tenantGate (PLATFORM_DB status, 30s cache per tenant)
 │    → requireAuth (against picked D1) → requirePerm / branchScope (unchanged)
 ├─ POST /api/v1/billing/slip         (auth, R2 upload, creates payment PENDING)
 └─ /platform/v1/*                    (staff, unchanged + approve/reject slip)
```

Tenant resolution (builder detail):
- New cookies: `goldos_tenant=<slug>; Path=/; 30d; Lax`. Login sets it.
  Every authenticated call reads it first; fallback `X-Shop-Slug` header.
  Session cookie stays `session; Path=/; HttpOnly; Secure` with
  `SameSite=None` in production (cross-site app+api, see §8 O1) and `Lax`
  on localhost. `goldos_tenant` picker cookie is readable by JS (no HttpOnly).
  If the session id is not found in the resolved tenant's D1 → 401, never
  try other D1s (prevents cross-shop session replay). Logout clears both cookies.
- New PLATFORM_DB table `tenant_bindings (tenant_id UNIQUE, binding TEXT,
  d1_id TEXT, created_at)` — maps tenant → `DB_Tn` binding name. `tenants.data_plane`
  continues to store the same binding name (back-compat with `resolveDataPlane`).
- New helper `resolveShopDb(env, slugOrId): {db, tenant}` — looks up tenant row
  (ACTIVE/SUSPENDED, not ARCHIVED for login), returns bound D1 or 503
  `PROVISIONING` if `status=ACTIVE` but no binding yet (signup race).
- `tenantGate` and `enforcePlanLimit` change signature from `env.TENANT_ID` to
  `c.get('tenantId')` set by `resolveTenant`. Keep unmanaged passthrough when
  `!PLATFORM_DB` (local single-shop dev).
- Sessions stay in shop D1 (no migration). Lookup flow tries bindings in order:
  `lookup` queries each reachable shop D1 `SELECT id FROM users WHERE email=?`
  (bounded fleet, cached 60s by email hash) and returns matching slugs only.
  Login then auths against exactly one D1 — timing-safe as today.

### 4.3 Provisioning (the sellable path)

Public signup input (zod, shared): `{shopName, slug^[a-z0-9-]{3,30}$,
ownerName, ownerEmail, password>=10 chars, phone?, country=LK, currency=LKR,
timezone, planId, interval}`.

Flow:
1. Validate `signup_enabled`, plan public/active, slug + email uniqueness
   (slug in PLATFORM_DB; email checked across bound D1s to warn duplicates
   but allowed — same owner may own 2 shops).
2. `createTenant` (existing) with `trialDays=14` → TRIALING, tenant ACTIVE.
3. Provision job — OUT-OF-BAND (builder-check decision, my call): Workers
   cannot shell out to `wrangler`, so `scripts/provision-tenant.mjs` runs on
   the owner's machine/CI with `CLOUDFLARE_API_TOKEN`. It `wrangler d1
   create`, applies `drizzle/*.sql` in order (chart of accounts + default
   settings rows come from migrations 0008/0015/0018/0031/0032 — verified),
   then runs `buildSeedSql` from `src/seed.ts` (roles/permissions/owner/HQ
   branch only — no extra seed needed). Then writes `tenant_bindings` +
   mirrors `tenants.data_plane`. Until the binding exists the API returns
   503 `PROVISIONING` for that slug; signup response includes
   `provisioning: pending` and the Tenants detail page has a Retry button
   (`job_runs type=provision` records each attempt).
4. Return `{slug, loginUrl: /login?shop=<slug>}`. Auto-login as owner (set
   `goldos_tenant` + `session` cookie).

Fleet ceiling (my call): Cloudflare allows ~10 D1 bindings per Worker.
Keep legacy `DB` for unmanaged dev, reserve `PLATFORM_DB`, add
`DB_T1..DB_T8` (8 sellable shops on one deploy). Provision script picks
first free binding; when full the signup returns 503 `FLEET_FULL` + staff
alert. Scaling beyond 8 is Phase B (second worker shard or D1 HTTP API).

Source of truth (my call): `tenant_bindings(tenant_id UNIQUE, binding,
d1_id, created_at)` is authoritative; `tenants.data_plane` is a mirror kept
for back-compat `resolveDataPlane`. Write order: bindings row first, then
`data_plane`. Migration `0002_saas.sql` backfills bindings from existing
`data_plane` values.

Rate limits (my call, no new infra): reuse D1-backed throttling (same
pattern as `login_attempts`) + in-memory cache like `gateCache`. Signup
5/hr/IP, lookup 20/min/IP. No KV/DO in v1.

DB plumbing scope (my call): new `getShopDb(c)` helper replaces every
`getDb(c.env)` / direct `c.env.DB` read in authenticated routes, `tenantGate`,
`currentPlan`, `enforcePlanLimit`, `platformBridge`, support, impersonation,
audit. Legacy `env.DB` is used ONLY when `!PLATFORM_DB` (unmanaged local
dev) — never as fallback in managed mode. Crons iterate all bindings via
`tenant_bindings`. `TENANT_ID` env is deprecated (kept as read-only hint for
old deploys, ignored when bindings exist).

Admin create: same service, extra field `skipEmailCheck`, staff picker for
plan/interval/trialDays, checkbox "send invite" (v1: show temp password once;
no email sender yet).

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
- Platform console: Tenants detail gets Provisioning card (binding, D1 id,
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
- `purgeTenant` stays control-plane only; document that shop D1 delete is
  manual (`wrangler d1 delete`) in v1.

## 5. Phased build (sizes)

- Phase A (sellable MVP, this plan): signup + provision script + login picker +
  per-request tenant resolve + receipts billing + marketing pricing + trial
  banners. Bounded fleet (10 bindings pre-declared).
- Phase B (later): Cloudflare API auto-create D1 + deploy-free scaling,
  payments.lk webhook, email (invite, dunning, receipts), custom domains,
  storage metering, self-serve plan change with proration.

## 6. Test plan (builder)

- `platform.provision.test.ts`: signup → tenant TRIALING 14d → binding written
  → owner can login → second signup slug clash 409.
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

- Fleet bound at 10 (`DB_T1..DB_T10`) in `wrangler.toml`; provision script
  picks first free. Documented scaling path, not hidden limit.
- Passwords per-shop (not central) to avoid migrating 69 tables. Same email
  may own N shops with different passwords — picker explains this.
- Receipts table in PLATFORM_DB (not shop DB) so billing survives shop archive.
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
- O2 Fleet: ANSWERED 2026-10-13 — 8 shops per deploy is enough to start.
  Phase B (shard / D1 HTTP API) only when fleet fills.
