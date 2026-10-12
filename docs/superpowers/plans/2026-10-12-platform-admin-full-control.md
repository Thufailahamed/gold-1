# Platform Admin Full Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give platform admin full access and control via missing control-plane primitives + dashboard UI.

**Architecture:** Extend existing Hono control-plane (separate PLATFORM_DB, psession auth, P.* perms) with 5 new service/route modules following existing patterns (parseBody, actor, ok, buildPlatformAudit). Extend Next.js console with command palette + bulk UI following existing papi/can/ReasonDialog patterns.

**Tech Stack:** Hono + D1/SQLite, Zod in @goldos/shared, Next.js + TanStack Query, Recharts existing.

**Spec:** User request 2026-10-12: "are all the features needed for admin implemented fully in platform admin dashboard?? if not implement it fully. the admin has all the access and control in the system fully"

## Global Constraints

- Never mix tenant `users:*` and platform `p.*` perms.
- Every mutating admin op must write platform_audit_logs via buildPlatformAudit with reason where existing pattern uses reason.
- Permission checks via requirePlatformPerm, never role names.
- Zod schemas live in packages/shared/src/platform.ts.
- Frontend gates via can(me, perm), invisible if missing.

## Review Focus

- Search leaking data across tenants without perm check — expect scoped by perm.
- Bulk action partially succeeding — expect all-or-nothing per tenant with per-id results, no silent skips.
- Purge deleting ACTIVE tenant — expect reject unless ARCHIVED.
- Revoking already-consumed grant — expect idempotent ok, no error leak.
- Refund exceeding paid amount — expect validation error, invoice stays consistent.

---

### Task 1: Global search API + schemas

**Files:**
- Modify: `packages/shared/src/platform.ts`
- Create: `apps/api/src/platform/services/search.ts`
- Modify: `apps/api/src/platform/index.ts`
- Create: `apps/api/src/platform/routes/search.ts`

**Interfaces:**
- Consumes: listTenants, listInvoices, support ticket list, platform_admins table
- Produces: `GET /platform/v1/search?q=&limit=` -> `{tenants[], invoices[], tickets[], admins[]}`, `searchPlatform(db, q, limit)` 

- [ ] **Step 1: Write the failing test**

```typescript
// in apps/api/src/platform/search.test.ts
test('search returns tenants, invoices, tickets by query', async () => {
  const r = await searchPlatform(db, 'kandy', 10);
  expect(r.tenants.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/platform/search.test.ts`
Expected: FAIL with "searchPlatform not defined"

- [ ] **Step 3: Implement `searchPlatform(db, q, limit)` + route + schemas**

Add `platformSearchSchema` to shared. Service does LIKE queries on tenants(name/slug/owner_email), invoices(number), tickets(number/subject), admins(email/name) with LIMIT. Route requires TENANTS_VIEW (lowest common read perm) and filters sections by extra perms (billing->invoices, support->tickets, admins->admins).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/platform/search.test.ts src/platform/platform.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/platform.ts apps/api/src/platform/services/search.ts apps/api/src/platform/routes/search.ts apps/api/src/platform/index.ts
git commit -m "feat(platform): global admin search"
```

### Task 2: Bulk tenant actions

**Files:**
- Modify: `packages/shared/src/platform.ts` (bulkTenantActionSchema)
- Modify: `apps/api/src/platform/services/tenants.ts` (bulkTenants)
- Modify: `apps/api/src/platform/routes/tenants.ts`

**Interfaces:**
- Consumes: suspendTenant, unsuspendTenant, archiveTenant, restoreTenant, changePlan from existing services
- Produces: `POST /platform/v1/tenants/bulk {ids[], action, reason, planId?, interval?}` -> `{results: [{id, ok, error?}]}`

- [ ] **Step 1: Write failing test**

```typescript
test('bulk suspend suspends two tenants', async () => {
  const r = await bulkTenants(db, {ids:[a,b], action:'suspend', reason:'abuse probe'}, admin);
  expect(r.results.filter(x=>x.ok)).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/platform/bulk.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `bulkTenants` + route with per-id try/catch, perm mapping (suspend->TENANTS_SUSPEND, archive/restore->TENANTS_DELETE, change-plan->BILLING_MANAGE)**

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api exec vitest run src/platform/bulk.test.ts src/platform/platform.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(platform): bulk tenant actions"
```

### Task 3: Tenant purge (hard delete) + single export

**Files:**
- Modify: `apps/api/src/platform/services/tenants.ts` (purgeTenant, exportTenant)
- Modify: `apps/api/src/platform/routes/tenants.ts` (`DELETE /:id/purge`, `GET /:id/export.json`)

**Interfaces:**
- Produces: `purgeTenant(db, id, reason, actor)` deletes control-plane rows (subscriptions, invoices, payments, tickets, notes, usage, overrides, grants, events, tenant) only if ARCHIVED; `exportTenant` returns full JSON snapshot.

- [ ] **Step 1: Write failing test**

```typescript
test('purge rejects ACTIVE tenant', async () => {
  await expect(purgeTenant(db, activeId, 'gdpr', admin)).rejects.toThrow(/archived/i);
});
test('purge deletes archived tenant and all children', async () => {
  await purgeTenant(db, archivedId, 'gdpr verified', admin);
  expect(await loadTenant(db, archivedId).catch(()=>null)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/platform/purge.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement purge + export routes (purge requires TENANTS_DELETE)**

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api exec vitest run src/platform/purge.test.ts src/platform/platform.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(platform): tenant purge and export"
```

### Task 4: Impersonation kill-switch

**Files:**
- Modify: `apps/api/src/platform/services/ops.ts` (listActiveImpersonations, revokeImpersonation, revokeAllImpersonations)
- Modify: `apps/api/src/platform/routes/tenants.ts` + new `apps/api/src/platform/routes/admin.ts` additions

**Interfaces:**
- Produces: `GET /platform/v1/impersonations/active`, `DELETE /platform/v1/impersonations/:id`, `DELETE /platform/v1/tenants/:id/impersonations`

- [ ] **Step 1: Write failing test**

```typescript
test('revoke kills unconsumed grant', async () => {
  const g = await createImpersonation(db, env, tenantId, {reason:'x'}, admin);
  const id = grantIdFromDb();
  await revokeImpersonation(db, id, 'abuse', admin);
  expect(consumedOrDeleted()).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/platform/impersonation-revoke.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement revoke (delete grant + audit tenant.impersonate_revoke). Active = expires_at > now AND consumed_at IS NULL.**

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api exec vitest run src/platform/impersonation-revoke.test.ts src/platform/platform.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(platform): impersonation revoke kill-switch"
```

### Task 5: Payment refund / void payment

**Files:**
- Modify: `packages/shared/src/platform.ts` (refundPaymentSchema)
- Modify: `apps/api/src/platform/services/billing.ts` (voidPayment / refundPayment)
- Modify: `apps/api/src/platform/routes/billing.ts` (`POST /payments/:id/void`, `POST /payments/:id/refund`)

**Interfaces:**
- Produces: `voidPayment(db, paymentId, reason, actor)` reverses payment: DELETE payment row, decrement invoice amount_paid, set status OPEN if was PAID, audit invoice.refund.

- [ ] **Step 1: Write failing test**

```typescript
test('void payment reopens PAID invoice', async () => {
  await recordPayment(...full amount...);
  await voidPayment(db, paymentId, 'duplicate entry', admin);
  expect(invoice.status).toBe('OPEN');
});
test('refund rejects unknown payment', async () => {
  await expect(voidPayment(db, 'missing', 'x', admin)).rejects.toThrow(/not found/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/platform/refund.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement voidPayment + routes (BILLING_MANAGE)**

- [ ] **Step 4: Run tests**

Run: `pnpm --filter api exec vitest run src/platform/refund.test.ts src/platform/platform.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(platform): payment refund and void"
```

### Task 6: Dashboard UI — command palette + bulk + purge + revoke + refund

**Files:**
- Create: `apps/web/components/platform/command-palette.tsx`
- Modify: `apps/web/components/platform/shell.tsx` (mount palette, Cmd+K button)
- Modify: `apps/web/app/platform/(console)/tenants/page.tsx` (bulk select + bar)
- Modify: `apps/web/app/platform/(console)/tenants/[id]/page.tsx` (purge section, revoke-all, active grants)
- Modify: `apps/web/components/platform/invoice-drawer.tsx` (refund/void payment buttons)
- Modify: `apps/web/app/platform/(console)/system/page.tsx` (active impersonations panel) — optional if time, else skip

**Interfaces:**
- Consumes: Tasks 1-5 APIs via papi()
- Produces: Admin can search (Cmd+K), bulk act, purge archived, revoke grants, refund payments from UI.

- [ ] **Step 1: Write failing component check (manual: palette renders, bulk bar appears)**

No unit test infra for Next.js here — verify via `pnpm --filter goldos-web exec tsc --noEmit`

- [ ] **Step 2: Run typecheck to verify it fails (missing modules)**

Run: `pnpm --filter goldos-web exec tsc --noEmit`
Expected: FAIL missing command-palette

- [ ] **Step 3: Implement UI files**

- [ ] **Step 4: Run typecheck + lint**

Run: `pnpm --filter goldos-web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(platform-ui): command palette, bulk, purge, revoke, refund"
```
