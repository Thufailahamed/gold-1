# Sellable Multi-Tenant SaaS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn GoldOS into sellable single-domain SaaS: public signup with 14-day trial, isolated shop per account, shop-picker login, bank-slip billing with admin approval.

**Architecture:** Keep DB-per-shop. Add per-request tenant resolution (`goldos_tenant` slug → D1 binding via `tenant_bindings`) replacing `TENANT_ID` pin; provisioning runs out-of-band via script; sessions stay per-shop D1.

**Tech Stack:** Cloudflare Workers + Hono, D1 xN, R2, Next.js, Drizzle (raw `prepare` pattern), Vitest, `@goldos/shared` zod.

**Spec:** `docs/superpowers/specs/2026-10-13-saas-multitenant-design.md`

## Global Constraints

- Shop schema keeps NO `tenant_id` column; isolation is database-per-shop.
- Fleet v1 is 8 shops: bindings `DB_T1..DB_T8` + legacy `DB` (unmanaged dev only) + `PLATFORM_DB`; full signup returns 503 `FLEET_FULL`.
- `tenant_bindings` is source of truth; `tenants.data_plane` is a mirror.
- Passwords stay per-shop (scrypt); same email may own N shops.
- Receipts require full-amount match to one invoice in v1; partials rejected.
- Production is cross-site app+api: cookies `SameSite=None; Secure`; `WEB_ORIGIN` includes app origin; CORS `Allow-Credentials:true`.
- Session id found in no resolved tenant D1 → 401, never try other D1s; logout clears `session` + `goldos_tenant`.
- No new infra (no KV/DO); throttles are D1-backed + in-memory cache.
- Every task TDD with `vitest run`, then commit.

## Review Focus

- Forged `goldos_tenant=B` with shop-A session must 401, not leak B data — pinned in Task 2 test.
- Signup with taken slug must 409 without revealing owner email — pinned in Task 3 test.
- `lookup` for unknown email must cost same time bucket and return `[]` — pinned in Task 3 test.
- Suspended tenant login/auth must 403 `TENANT_SUSPENDED` even with valid password — pinned in Task 2 test.
- Slip upload >5MB or non png/jpg/pdf must 400 before R2 write — pinned in Task 5 test.

---

### Task 1: Control-plane migration + shared SaaS schemas

**Files:**
- Create: `apps/api/drizzle-platform/0002_saas.sql`
- Modify: `packages/shared/src/platform.ts`
- Test: `packages/shared/src/platform.test.ts` (extend), `apps/api/src/platform/saas-migration.test.ts` (new)

**Interfaces:**
- Consumes: existing `0001_platform.sql` tables `tenants`, `invoices`.
- Produces: `tenant_bindings(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), binding TEXT NOT NULL UNIQUE, d1_id TEXT, created_at INTEGER NOT NULL)`; `tenant_receipts(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), invoice_id TEXT NOT NULL REFERENCES invoices(id), r2_key TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), bank_ref TEXT, reject_reason TEXT, uploaded_by TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')), created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT)`; `CREATE INDEX idx_receipts_tenant ON tenant_receipts(tenant_id, created_at)`; backfill `INSERT INTO tenant_bindings SELECT id, data_plane, NULL, <now> FROM tenants WHERE data_plane IS NOT NULL`; zod `publicSignupSchema{shopName min2, slug regex ^[a-z0-9-]{3,30}$, ownerName, ownerEmail email, password min10, phone optional, country default LK, currency default LKR, timezone default Asia/Colombo, planId, interval enum MONTH|YEAR}`, `shopLookupSchema{email email}`, `shopLoginSchema{email email, password min1, slug}`, `receiptUploadSchema{invoiceId uuid, bankRef max120 optional}`; const `SAAS_SLUG_BLOCKLIST=['admin','api','platform','support','login','signup','billing']`, `RECEIPT_MAX_BYTES=5242880`, `RECEIPT_MIME=['image/png','image/jpeg','application/pdf']`.

- [ ] **Step 1: Write failing shared-schema tests** in `packages/shared/src/platform.test.ts` — assert `publicSignupSchema` rejects slug `Admin!`, accepts 14-day default, `shopLoginSchema` requires slug.
- [ ] **Step 2: Run to verify fail** — Run: `pnpm --filter @goldos/shared test 2>&1 | tail -20` Expected: FAIL, schemas undefined.
- [ ] **Step 3: Implement schemas + constants** in `packages/shared/src/platform.ts` (append, re-exported via existing `index.ts`).
- [ ] **Step 4: Write failing migration test** in `apps/api/src/platform/saas-migration.test.ts` — apply `0001`+`0002` to in-memory/mini-D1, assert both tables exist and blocklisted slug insert still allowed at DB level (app enforces).
- [ ] **Step 5: Write `0002_saas.sql`** with tables/indexes/backfill above.
- [ ] **Step 6: Run tests to verify pass** — Run: `pnpm --filter @goldos/shared test 2>&1 | tail -5` and `pnpm --filter goldos-api test 2>&1 | tail -5` Expected: PASS.
- [ ] **Step 7: Commit** — `git add packages/shared/src/platform.ts packages/shared/src/platform.test.ts apps/api/drizzle-platform/0002_saas.sql apps/api/src/platform/saas-migration.test.ts && git commit -m "feat(saas): bindings+receipts schema and public auth schemas"`

### Task 2: Per-request tenant resolution (kill `TENANT_ID` pin)

**Files:**
- Create: `apps/api/src/platform/resolve.ts`, `apps/api/src/platform/resolve.test.ts`
- Modify: `apps/api/src/db/client.ts`, `apps/api/src/middleware/auth.ts:35-78`, `apps/api/src/platform/bridge.ts:30-113`, `apps/api/wrangler.toml`
- Test: `apps/api/src/platform/resolve.test.ts`, `apps/api/src/platform/multitenant.isolation.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `tenant_bindings`.
- Produces: `TENANT_COOKIE='goldos_tenant'`, `extractTenantSlug(c): string|undefined` (cookie first, then `x-shop-slug` header, then `?shop=`), `resolveShopDb(env, slugOrId): Promise<{db: D1Database, tenant: {id, slug, status, suspended_reason}}>` (throws `PROVISIONING_503` when ACTIVE but no binding, `TENANT_SUSPENDED_403`/`TENANT_ARCHIVED_403`), `getShopDb(c): D1Database` (reads `c.get('shopDb')`), middleware `resolveTenant` setting `c.set('tenantId'|'shopDb'|'tenantSlug')`; `Env` gains `DB_T1..DB_T8?: D1Database` (legacy `DB` + `TENANT_ID?` retained, `TENANT_ID` ignored when bindings exist); `tenantGate`/`currentPlan`/`enforcePlanLimit` read `c.get('tenantId')`; `requireAuth` reads `c.get('shopDb') ?? c.env.DB`.

- [ ] **Step 1: Write failing resolve tests** — `resolveShopDb` returns bound D1 for slug, 503 when no binding, 403 when SUSPENDED; `extractTenantSlug` prefers cookie over header.
- [ ] **Step 2: Run to verify fail** — Run: `pnpm --filter goldos-api test src/platform/resolve.test.ts 2>&1 | tail -10` Expected: FAIL module missing.
- [ ] **Step 3: Implement `resolve.ts`** — PLATFORM_DB lookup `SELECT id, slug, status, suspended_reason, data_plane FROM tenants WHERE slug=? OR id=?`, then `tenant_bindings` → `binding`, then `(env as Record)[binding]` must be D1 else 503. 30s per-tenant in-memory cache (same pattern as `gateCache`).
- [ ] **Step 4: Write failing isolation tests** — seed two shop DBs A/B; session from A with `goldos_tenant=B-slug` → 401; suspended tenant → 403 `TENANT_SUSPENDED`; unmanaged (`!PLATFORM_DB`) passthrough.
- [ ] **Step 5: Refactor `client.ts` Env + `auth.ts requireAuth` + `bridge.ts tenantGate/currentPlan/enforcePlanLimit`** to per-request values with unmanaged fallback; wire `resolveTenant` before `tenantGate` in `app.ts:56` (`app.use("/api/v1/*", resolveTenant)` first).
- [ ] **Step 6: Add `DB_T1..DB_T8` stubs to `wrangler.toml`** (commented `database_id="PENDING-provision"` placeholders the provision script fills).
- [ ] **Step 7: Run tests to verify pass** — Run: `pnpm --filter goldos-api test 2>&1 | tail -5` Expected: PASS, no existing suite broken.
- [ ] **Step 8: Commit** — `git add apps/api/src/platform/resolve.ts apps/api/src/platform/resolve.test.ts apps/api/src/platform/multitenant.isolation.test.ts apps/api/src/db/client.ts apps/api/src/middleware/auth.ts apps/api/src/platform/bridge.ts apps/api/src/app.ts apps/api/wrangler.toml && git commit -m "feat(saas): per-request tenant resolution, gate/limits off TENANT_ID pin"`

### Task 3: Public auth — plans, signup, lookup, slug login

**Files:**
- Create: `apps/api/src/routes/public.ts`, `apps/api/src/routes/public.test.ts`
- Modify: `apps/api/src/app.ts:63-64`, `apps/api/src/routes/auth.ts:40-99`
- Test: `apps/api/src/routes/public.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas, Task 2 `resolveShopDb`.
- Produces: `GET /api/v1/public/plans` → public+active plans (code,name,prices,currency,trial_days,limits,features); `POST /api/v1/public/signup` (D1-throttled 5/hr/IP, honeypot field `company_website` must be empty, slug blocklist, 409 slug taken with generic message, creates tenant TRIALING 14d via existing `createTenant` + `job_runs` row `job='provision' status='RUNNING'`, returns `{slug, loginUrl:/login?shop=<slug>, provisioning:'pending'}`); `POST /api/v1/auth/lookup {email}` (20/min/IP, returns `[{slug,name}]` only, same latency for unknown); `POST /api/v1/auth/login {email,password,slug}` (resolves D1 first, then existing scrypt+throttle+session flow against that D1, sets `session` cookie `SameSite=None; Secure; HttpOnly` + `goldos_tenant=<slug>; Max-Age=2592000; Path=/; Secure; SameSite=None` + `X-Session-Id`); `GET /api/v1/public/provisioning/:slug` → `{status: pending|ready, tenantId}`.

- [ ] **Step 1: Write failing public tests** — plans list hides non-public; signup rejects blocklisted slug 400 + taken slug 409 without email leak; lookup unknown → `[]`; login with wrong slug → 401; login sets both cookies.
- [ ] **Step 2: Run to verify fail** — Run: `pnpm --filter goldos-api test src/routes/public.test.ts 2>&1 | tail -10` Expected: FAIL 404s.
- [ ] **Step 3: Implement `routes/public.ts`** reusing `createTenant`, `getPlatformSettings.signup_enabled` (503 `SIGNUP_DISABLED` when off).
- [ ] **Step 4: Extend `routes/auth.ts` login** to require `slug` (back-compat: missing slug + unmanaged single-DB → legacy `env.DB` path), `lookup` handler with D1-backed throttle table `public_throttle(key, count, window_start)` + in-memory cache.
- [ ] **Step 5: Mount in `app.ts`** — `app.route("/api/v1/public", publicRoutes)` BEFORE `resolveTenant` (public exempt), keep `tenantGate` exempt for `/public/*`.
- [ ] **Step 6: Run tests to verify pass** — Run: `pnpm --filter goldos-api test 2>&1 | tail -5` Expected: PASS.
- [ ] **Step 7: Commit** — `git add apps/api/src/routes/public.ts apps/api/src/routes/public.test.ts apps/api/src/routes/auth.ts apps/api/src/app.ts && git commit -m "feat(saas): public signup, plans, shop lookup and slug login"`

### Task 4: Provision script + retry

**Files:**
- Create: `apps/api/scripts/provision-tenant.mjs`, `apps/api/scripts/provision.test.mjs` (node assert, run via `node --test`)
- Modify: `apps/api/src/platform/routes/tenants.ts` (add retry endpoint), `apps/api/package.json`
- Test: script dry-run test + API retry test in `apps/api/src/platform/provision.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, existing `drizzle/*.sql`, `src/seed.ts:buildSeedSql`, `services/hash.ts` (scrypt done in Worker, script receives hash).
- Produces: `node scripts/provision-tenant.mjs --tenant=<id> --binding=<DB_Tn> [--dry-run]` (uses `wrangler d1 create` output id OR `CLOUDFLARE_API_TOKEN` REST; applies migrations in numeric order via `wrangler d1 execute --file`; writes seed SQL from `buildSeedSql` with owner id/email/name/hash + HQ branch; updates `tenant_bindings` + `tenants.data_plane`; marks `job_runs provision OK/FAILED`); `POST /platform/v1/tenants/:id/retry-provision` (perm `p.tenants:manage`, re-queues); npm script `"provision": "node scripts/provision-tenant.mjs"`.

- [ ] **Step 1: Write failing provision tests** — dry-run prints ordered migration list + seed with owner + binding SQL without touching D1; retry endpoint re-queues FAILED job.
- [ ] **Step 2: Run to verify fail** — Run: `node --test apps/api/scripts/provision.test.mjs 2>&1 | tail -5` Expected: FAIL missing file.
- [ ] **Step 3: Implement script** (out-of-band only; never imported by Worker; first-free-binding picker reading `tenant_bindings`; `FLEET_FULL` message when all 8 taken).
- [ ] **Step 4: Add retry endpoint + `provision` npm script.**
- [ ] **Step 5: Run tests to verify pass** — Run: `node --test apps/api/scripts/provision.test.mjs 2>&1 | tail -3 && pnpm --filter goldos-api test src/platform/provision.test.ts 2>&1 | tail -3` Expected: PASS.
- [ ] **Step 6: Commit** — `git add apps/api/scripts/provision-tenant.mjs apps/api/scripts/provision.test.mjs apps/api/src/platform/provision.test.ts apps/api/src/platform/routes/tenants.ts apps/api/package.json && git commit -m "feat(saas): out-of-band tenant provisioning with retry"`

### Task 5: Bank-slip billing (shop upload + staff approve/reject)

**Files:**
- Create: `apps/api/src/routes/billing-receipts.ts`, `apps/api/src/routes/billing-receipts.test.ts`
- Modify: `apps/api/src/platform/routes/billing.ts`, `apps/api/src/app.ts`
- Test: `apps/api/src/routes/billing-receipts.test.ts`

**Interfaces:**
- Consumes: Task 1 `tenant_receipts`, Task 2 `getShopDb`, existing `recordPayment` + billing_cycle PAST_DUE/suspend-lift rules.
- Produces: shop `POST /api/v1/billing/slips` (auth, multipart, 5MB/Reject MIME enforced pre-R2, key `receipts/<tenantId>/<uuid>`, body `{invoiceId, bankRef?}`, creates PENDING + audit); `GET /api/v1/billing/slips` (own tenant only); `GET /api/v1/billing/slips/:id/download` (owner of tenant or staff proxy); staff `GET /platform/v1/billing/receipts?status=PENDING`, `POST /platform/v1/billing/receipts/:id/approve` (perm `p.billing:manage`, full-amount check vs invoice `total-amount_paid`, calls `recordPayment`, sets APPROVED), `POST .../reject {reason max500}` (sets REJECTED + `reject_reason` + audit).

- [ ] **Step 1: Write failing receipt tests** — upload 6MB → 400; wrong MIME → 400; approve under-amount → 400; approve full → invoice PAID + PAST_DUE cleared; reject stores reason; shop A cannot list shop B slips.
- [ ] **Step 2: Run to verify fail** — Run: `pnpm --filter goldos-api test src/routes/billing-receipts.test.ts 2>&1 | tail -8` Expected: FAIL 404.
- [ ] **Step 3: Implement shop routes + R2 put** (stream size cap, content-type allowlist from Task 1 constants).
- [ ] **Step 4: Implement staff approve/reject** reusing `recordPayment` + `buildPlatformAudit`.
- [ ] **Step 5: Run tests to verify pass** — Run: `pnpm --filter goldos-api test 2>&1 | tail -5` Expected: PASS.
- [ ] **Step 6: Commit** — `git add apps/api/src/routes/billing-receipts.ts apps/api/src/routes/billing-receipts.test.ts apps/api/src/platform/routes/billing.ts apps/api/src/app.ts && git commit -m "feat(saas): bank-slip upload with staff approve/reject"`

### Task 6: Web — signup, picker login, pricing, trial/billing UI, cross-site wiring

**Files:**
- Create: `apps/web/app/signup/page.tsx`, `apps/web/app/billing/page.tsx`, `apps/web/lib/tenant.ts`
- Modify: `apps/web/app/login/page.tsx`, `apps/web/app/page.tsx` (pricing section + CTA `/signup`), `apps/web/lib/api.ts:3,45-49`, `apps/web/app/(app)/layout.tsx`, `apps/web/components/platform-banner.tsx`
- Test: `pnpm --filter goldos-web lint` (`tsc --noEmit`) + manual two-browser checklist in plan (no web test runner exists).

**Interfaces:**
- Consumes: Tasks 3+5 endpoints, existing `platform/context`.
- Produces: `lib/tenant.ts: readTenantSlug(), writeTenantSlug(slug), clearTenant()` (cookie `goldos_tenant`, 30d, `SameSite=None; Secure` in prod); `api()` sends `X-Shop-Slug` header from cookie as fallback; `MeData` gains `tenant: {id, slug, name} | null`; `/signup` 3-step (shop→owner→plan, honeypot, success shows slug + login link); `/login` email→lookup→shop radio (preselect `?shop=`/cookie)→password→login; `/` pricing from `GET /public/plans` + CTAs to `/signup`; `(app)` layout trial banner (TRIALING days-left + Pay) + SUSPENDED/ARCHIVED blocked screen with support email; `(app)/billing` open invoices + upload + receipt status; `NEXT_PUBLIC_API_URL=https://api.<domain>` documented in `.env.local` comment.

- [ ] **Step 1: Implement `lib/tenant.ts` + `api.ts` header/cookie wiring + `MeData.tenant`.**
- [ ] **Step 2: Rework `/login` to lookup+picker flow** (generic error copy, no email oracle).
- [ ] **Step 3: Build `/signup` + `/` pricing section.**
- [ ] **Step 4: Add trial banner/blocked screen + `/billing` page.**
- [ ] **Step 5: Verify** — Run: `pnpm --filter goldos-web lint 2>&1 | tail -5` Expected: clean; manual: two shops in two browsers, sale in A invisible in B.
- [ ] **Step 6: Commit** — `git add apps/web/app/signup/page.tsx apps/web/app/billing/page.tsx apps/web/lib/tenant.ts apps/web/app/login/page.tsx apps/web/app/page.tsx apps/web/lib/api.ts "apps/web/app/(app)/layout.tsx" apps/web/components/platform-banner.tsx && git commit -m "feat(saas): signup, shop-picker login, pricing and billing UI"`

### Task 7: Staff console, cron fleet, cookies/CORS cutover, docs

**Files:**
- Modify: `apps/api/src/platform/routes/tenants.ts` (provisioning card data), `apps/api/src/platform/routes/billing.ts` (receipts queue already from Task 5 — add CSV), `apps/api/src/platform/services/ops.ts:200-221` (`collectAllUsage` via bindings), `apps/api/src/platform/index.ts:38-55` (provision retry in cron), `apps/api/src/routes/auth.ts:32-37` (prod `None;Secure` vs localhost `Lax`), `apps/api/wrangler.toml:6-7` (`WEB_ORIGIN` app origin), `apps/web/app/platform/(console)/tenants/[id]/page.tsx`, `apps/web/app/platform/(console)/billing/page.tsx`, `docs/deployment.md`, `docs/platform.md`
- Test: `apps/api/src/platform/fleet.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: tenant detail returns `{binding, d1Id, provisioning: ready|pending|failed}`; impersonation checks resolved tenant == grant tenant (not `TENANT_ID`); `collectAllUsage` iterates `tenant_bindings` via `resolveDataPlane`-compat; cookie helper `sessionCookie(id, maxAge, isLocalhost)`; `WEB_ORIGIN=https://app.<domain>,http://localhost:3000`; docs updated (provision command, fleet-full path, manual D1 delete on purge, `platform:migrate` includes `0002`).

- [ ] **Step 1: Write failing fleet tests** — `collectAllUsage` collects from 2 bindings, counts unreachable; signup when 8 bound → `FLEET_FULL`; impersonation grant for tenant A rejected when resolved tenant is B.
- [ ] **Step 2: Run to verify fail** — Run: `pnpm --filter goldos-api test src/platform/fleet.test.ts 2>&1 | tail -8` Expected: FAIL.
- [ ] **Step 3: Implement console data + cron + cookie helper + `WEB_ORIGIN`.**
- [ ] **Step 4: Update platform console pages (provisioning card, receipts queue) + docs.**
- [ ] **Step 5: Full verification** — Run: `pnpm test 2>&1 | tail -8` Expected: all green.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(saas): fleet cron, cross-site cookies, console and docs cutover"`

## Self-Review

1. **Spec coverage:** G1 signup+provision Tasks 3–4; G2 admin create reuses `createTenant` Task 3 + retry Task 4; G3 picker Task 3+6; G4 per-request Task 2; G5 slips Task 5; G6 gate/limits Task 2; G7 trial/dunning/support via existing `context` + Task 6 banner; G8 plan change stays manual (existing route, no task needed — correctly out of scope).
2. **Step scan:** each step names one artifact + checkable run; fixed transcript risk by keeping bodies to signatures/values only.
3. **Type consistency:** `resolveShopDb`/`getShopDb`/`extractTenantSlug`/`TENANT_COOKIE` named once in Task 2 and reused verbatim in Tasks 3/5/7; `tenant_receipts` columns identical Task 1→5; cookie names identical Task 3→6→7.
4. **Review Focus:** all five mapped to owning-task tests above.
5. **Proportion:** 7 tasks for a 5-goal MVP; code bodies left to implementer, only interfaces/values pinned.
