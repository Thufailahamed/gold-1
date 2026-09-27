# GoldOS Architecture

## Monorepo

```
gold-1/
  apps/web/          Next.js 16 App Router (React 19), Tailwind, RHF + Zod
  apps/api/          Hono on Cloudflare Workers, Drizzle ORM → D1, R2 binding
  packages/shared/   Zod schemas, permission constants, ApiResponse<T> type
  docs/              This documentation set
```

> Note: the spec asked for "Next.js 19", which does not exist (latest stable
> is 16.x). The web app uses Next 16 + React 19.

## Request flow

```
UI (RHF + Zod client validation)
 → Hono route (Zod server validation → requireAuth → requirePerm → handler)
 → service (D1 batch: business write + audit_logs in ONE atomic batch)
 → { success: true, data } / { success: false, error: { code, message } }
 → TanStack Query cache (Phase 2) / direct fetch (Phase 1 shell)
```

## Layer rules

- Routes parse and validate only; no SQL outside services and auth middleware.
- Services own all D1 logic via `db.batch([...])`.
- Middleware owns auth (`requireAuth`), RBAC (`requirePerm`), errors, audit.
- `packages/shared` owns contracts; web and api both import from it.
- Strict TypeScript everywhere, no `any`.

## Dual-ledger principle

Every gram of gold and every rupee must be traceable. Phase 1 lays the
foundation (atomic batches + append-only audit). Phase 2 adds the gold ledger
and financial ledger tables; see `gold-accounting.md`.
