# GoldOS Deployment

## Prereqs

Cloudflare account with Workers, D1 (`goldos`), R2 (`goldos-assets`).
`apps/api/wrangler.toml` binds `DB` and `R2`. Replace `REPLACE_WITH_REAL_ID`
with the real D1 `database_id` (remote migration in Task 8 was deferred —
no database ID was provided, so only local D1 has been migrated).

## Migrate

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
