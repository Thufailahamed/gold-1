# GoldOS Deployment

## Prereqs

Cloudflare account with Workers, D1, R2 (`goldos-assets`).
`apps/api/wrangler.toml` binds `DB` (legacy single shop), `PLATFORM_DB`
(control plane) and `R2`.

Live (2026-09-27):
- API: https://goldos-api.thufailahamed627.workers.dev
- Web: https://goldos-web.thufailahamed627.workers.dev
- D1: `goldos` (27c637f8-6a15-4012-bd7e-8b7b601df400), region APAC
- D1: `goldos-platform` (4aa27d78-db29-42c8-b76f-295f30d48dc4) — SaaS control plane
- R2: `goldos-assets`
- Web `apps/web/.env.local` points `NEXT_PUBLIC_API_URL` at the Workers URL.

## SaaS mode (multi-shop)

One API deploy serves every shop. Each signup auto-creates its own D1 via
the Cloudflare API — no binding or redeploy per shop.

```bash
wrangler secret put CLOUDFLARE_ACCOUNT_ID     # Cloudflare account id
wrangler secret put CLOUDFLARE_D1_API_TOKEN   # API token with D1 edit rights
wrangler secret put PLATFORM_BOOTSTRAP_TOKEN  # one-time: creates the first super admin
pnpm --filter goldos-api platform:migrate:remote   # applies drizzle-platform/* incl. 0002_saas + 0003_throttle
```

Then open `/platform/setup`, create the super admin, delete the bootstrap
secret. Requires Workers Paid ($5/mo) past 10 databases; usage fits the
included limits until large.

Shop migrations change? Regenerate the signup bundle (committed):

```bash
pnpm --filter goldos-api bundle:migrations
```

Adopting the existing single shop: create its tenant in `/platform/tenants`,
insert `tenant_databases` pointing at the current D1 id, add the owner to
`tenant_members`. Zero data migration.

Set `WEB_ORIGIN` in `wrangler.toml` to the app origin
(`https://app.<domain>,http://localhost:3000`) once the domain is live —
shop cookies are `SameSite=None; Secure` for the cross-site app+api split.

## Cloud sync (use this)

```bash
./scripts/cloudflare-sync.sh                # migrate remote DB + deploy backend
./scripts/cloudflare-sync.sh --db-only       # migrate remote DB only
./scripts/cloudflare-sync.sh --backend-only  # deploy backend only
```

Migrations in `apps/api/drizzle/*.sql` are tracked in the remote
`schema_migrations` table — re-runs only apply pending files, then the
worker is deployed and health-checked.

## Migrate (manual alternative)

```bash
# local
pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0001_core.sql
# remote (needs real database_id in wrangler.toml)
pnpm --filter goldos-api exec wrangler d1 execute goldos --remote --file ./drizzle/0001_core.sql
```

## Seed (one admin + main branch)

Generate a scrypt hash, then insert roles/permissions/admin/branch via
`wrangler d1 execute` (see `apps/api/src/seed.ts` for the exact statements).
Never commit plaintext passwords; `seed.sql` is git-ignored.

## Run

```bash
pnpm --filter goldos-api exec wrangler dev --local --port 8787
NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter goldos-web exec next dev --port 3000
```

Deploy API with `wrangler deploy` (or `./scripts/cloudflare-sync.sh --backend-only`);
deploy web with `pnpm --filter goldos-web run deploy`.
