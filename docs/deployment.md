# GoldOS Deployment

## Prereqs

Cloudflare account with Workers, D1 (`goldos`), R2 (`goldos-assets`).
`apps/api/wrangler.toml` binds `DB` and `R2`.

Live (2026-09-27):
- API: https://goldos-api.thufailahamed627.workers.dev
- D1: `goldos` (27c637f8-6a15-4012-bd7e-8b7b601df400), region APAC
- R2: `goldos-assets`
- Web `apps/web/.env.local` points `NEXT_PUBLIC_API_URL` at the Workers URL
  (git-ignored; set the same env var when deploying to Pages).

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

Deploy API with `wrangler deploy`; deploy web to Cloudflare Pages with
`NEXT_PUBLIC_API_URL` pointed at the Workers URL.
