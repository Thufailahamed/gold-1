# GoldOS Platform (SaaS control plane)

The operator console for running GoldOS as a SaaS product: accounts, plans,
billing, feature flags, announcements, support, staff and audit. Web UI at
`/platform`, API at `/platform/v1`.

## Architecture

```
                 ┌──────────────── goldos-api worker ────────────────┐
 /platform (web) │ /platform/v1/*  → control plane → PLATFORM_DB (D1) │
                 │                                   ▲                │
 /  (shop web)   │ /api/v1/*  → tenantGate ──────────┘ status, limits │
                 │            → shop routes → DB (D1, one per shop)   │
                 └────────────────────────────────────────────────────┘
```

- **Control plane** — a separate D1 database, binding `PLATFORM_DB`,
  migrations in `apps/api/drizzle-platform/`. Shop data never lives here.
- **Data plane** — the existing shop database. `TENANT_ID` on the worker says
  which platform account it serves. `tenants.data_plane` names the D1 binding
  for an account (e.g. `DB_KANDY`) so usage collection can reach it.
- **Unmanaged mode** — with no `PLATFORM_DB` or `TENANT_ID`, the gate, limits
  and bridge are no-ops and a single-shop install behaves exactly as before.

Code: `apps/api/src/platform/` (services, routes, `bridge.ts`),
`packages/shared/src/platform.ts` (schemas, roles, billing maths, TOTP),
`apps/web/app/platform/`.

## Staff auth

Platform staff are **not** shop users. `platform_admins` + `platform_sessions`,
cookie `psession` scoped to `Path=/platform`.

- Session tokens are stored as SHA-256 hashes. 8h idle / 24h absolute.
- 5 failed passwords → 15-minute lock. Unknown emails still pay the scrypt cost.
- TOTP two-factor (RFC 6238). With 2FA on, login yields a half-open session
  that only `/auth/mfa` accepts.
- Role change, deactivation, password or 2FA reset revokes the target's sessions.
- The last active super admin cannot be demoted or deactivated.

Roles (fixed; code checks permissions, never role names):

| Role | Can |
|---|---|
| super_admin | everything, incl. staff and platform settings |
| operations | accounts, suspend, impersonate, plans, flags, announcements, support |
| billing | invoices, payments, coupons, subscription changes |
| support | ticket queue, impersonate, read accounts and billing |
| analyst | read-only |

**First run:** set `PLATFORM_BOOTSTRAP_TOKEN` (≥16 chars), open
`/platform/setup`, create the super admin, then delete the secret. Bootstrap only
works while there are no staff.

## Accounts & subscriptions

Tenant status: `ACTIVE` · `SUSPENDED` (kind `MANUAL` or `BILLING`) · `ARCHIVED`
(closed; purge scheduled 30 days out, restorable until then).

Subscription status: `TRIALING` → `ACTIVE` ⇄ `PAST_DUE` → `CANCELED`.

- A subscription **locks its price**. Editing a plan's list price never
  reprices existing accounts.
- Plan changes take effect immediately and are not prorated. A mid-period
  true-up is a one-off (manual) invoice.
- Every change writes `subscription_events` with MRR before/after. The
  dashboard's MRR trend and new/expansion/contraction/churn come from these deltas.
- MRR counts `ACTIVE` and `PAST_DUE`; trials and cancelled count zero.

## Billing cycle

`runBillingCycle` runs hourly from cron and on demand from Billing → Run
billing cycle. It is idempotent: a partial unique index on
`invoices(subscription_id, period_start)` stops a period being billed twice.

1. Expired trials → first paid period + invoice.
2. Periods that ended → renew + invoice (or cancel if scheduled). A coupon that
   has ended drops off at this point.
3. Open invoice past due → subscription `PAST_DUE`.
4. Past due beyond `past_due_grace_days` → tenant `SUSPENDED` / `BILLING`
   (when `auto_suspend_past_due`).

Paying, voiding or writing off the last overdue invoice clears `PAST_DUE` and
lifts a **BILLING** suspension. A **MANUAL** suspension is never lifted by
payment. Tax (`tax_rate_bps`) applies after discount. Invoices with payments
cannot be voided; write them off instead.

Payments are recorded manually (bank, card, cash, online). There is no card
gateway integration yet.

## Shop-side bridge

Mounted in the shop API:

| Piece | Effect |
|---|---|
| `tenantGate` on `/api/v1/*` | 403 `TENANT_SUSPENDED` / `TENANT_ARCHIVED`, 503 `MAINTENANCE`. Status cached 30s per isolate. Exempt: health, `/platform/context`, logout. |
| `enforcePlanLimit` | 403 `PLAN_LIMIT` on user create/activate, branch create, product create. Purchase intake is deliberately not gated. |
| `GET /api/v1/platform/context` | Plan, trial clock, balance, limits, evaluated feature flags, live announcements. Status only when signed out. |
| `/api/v1/platform/support` | Shops open and reply to tickets (internal notes hidden). |
| `POST /api/v1/platform/impersonate` | Redeems a staff sign-in link (see below). |

The shop web shows these in `PlatformBanner` and at `/support`.

**Impersonation:** staff give a reason and get a single-use link that expires in
`impersonation_ttl_minutes` (only its hash is stored). Redeeming it checks the
grant is for this worker's `TENANT_ID`, resolves the user, then consumes it
atomically. It creates a 1-hour shop session and writes `auth.impersonate`,
naming the staff member, to the **shop's** audit log.

## Feature flags

Precedence: account override → plan entitlement (`plans.features_json`) →
percentage rollout (stable FNV-1a bucket per tenant+flag) → default.

## Jobs (cron, `wrangler.toml`)

| Cron | Jobs |
|---|---|
| `0 * * * *` | billing_cycle, housekeeping (expired sessions, old grants and job runs) |
| `15 2 * * *` | collect_usage (snapshot users/branches/products/sales from each reachable shop DB) |

Every run, cron or manual, is recorded in `job_runs` and shown on System health.

## Deploy

```
wrangler d1 create goldos-platform            # paste id into wrangler.toml
pnpm --filter goldos-api platform:migrate:remote
wrangler secret put PLATFORM_BOOTSTRAP_TOKEN
# set TENANT_ID in [vars] once the shop's account exists
```

Local: `pnpm --filter goldos-api platform:migrate:local`, then
`wrangler dev --var PLATFORM_BOOTSTRAP_TOKEN:<token>`.

## Not built yet

- Card gateway (Stripe/PayHere) and automated emails (invoices, dunning, trial reminders).
- Public self-serve sign-up (the `signup_enabled` setting is reserved for it).
- Automatic provisioning of a new D1 per account and routing requests to it.
  Today an account's data plane is bound by config (`TENANT_ID` / `data_plane`).
- Storage metering (R2 usage reports 0) and the actual purge of archived data.
