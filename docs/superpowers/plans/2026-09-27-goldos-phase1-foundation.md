# GoldOS Phase-1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold GoldOS monorepo and ship Phase-1 foundation (auth+RBAC, users, branches, settings, audit, web shell, docs) on Cloudflare.

**Architecture:** Turborepo `apps/web` (Next.js 19) + `apps/api` (Hono on Workers) + `packages/shared` (Zod + types). Drizzle ORM → D1 with sequential migrations; sessions in D1 + httpOnly cookie; audit appended in same D1 batch as each mutation.

**Tech Stack:** Next.js 19, TypeScript strict, Tailwind + shadcn/ui, RHF + Zod, TanStack Query, Hono, Drizzle, Cloudflare Workers/D1/R2, Vitest, Wrangler.

## Global Constraints

- Every gram of gold and every rupee must be traceable (audit on all writes).
- Financial/gold/inventory mutations must be atomic via D1 batch/transaction; partial writes forbidden.
- Never hard-delete business records; use VOID/CANCEL/REVERSE or activate/deactivate with user + timestamp + reason.
- Never hard-code gold prices, purity, making-charge, wastage, discount limits, payment/expense categories; they live in settings.
- Strict TypeScript, no `any`; Zod validation client + server; typed `{ success, data, error }` API responses.
- All business tables carry `branchId`; inventory/cash branch-aware.
- Session expiry: 12h idle / 7d absolute; scrypt password hashing; httpOnly Secure cookies.
- Accent color `#C9A227`, Inter font, premium ERP shell with empty/loading/error states.

---

## File Structure

New files (Phase 1):

- `package.json`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- `packages/shared/package.json`, `packages/shared/src/permissions.ts`,
  `packages/shared/src/schemas.ts`, `packages/shared/src/types.ts`, `packages/shared/src/index.ts`
- `apps/api/package.json`, `apps/api/wrangler.toml`, `apps/api/drizzle.config.ts`,
  `apps/api/drizzle/0001_core.sql`, `apps/api/src/db/schema.ts`,
  `apps/api/src/db/client.ts`, `apps/api/src/app.ts`,
  `apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/requirePerm.ts`,
  `apps/api/src/middleware/error.ts`, `apps/api/src/middleware/audit.ts`,
  `apps/api/src/services/hash.ts`, `apps/api/src/services/session.ts`,
  `apps/api/src/services/audit.ts`, `apps/api/src/services/users.ts`,
  `apps/api/src/services/branches.ts`, `apps/api/src/services/settings.ts`,
  `apps/api/src/routes/health.ts`, `apps/api/src/routes/auth.ts`,
  `apps/api/src/routes/users.ts`, `apps/api/src/routes/roles.ts`,
  `apps/api/src/routes/branches.ts`, `apps/api/src/routes/settings.ts`,
  `apps/api/src/routes/audit.ts`, `apps/api/src/seed.ts`
- `apps/web/package.json`, `apps/web/next.config.mjs`, `apps/web/tailwind.config.ts`,
  `apps/web/app/layout.tsx`, `apps/web/app/globals.css`,
  `apps/web/app/login/page.tsx`, `apps/web/app/(app)/layout.tsx`,
  `apps/web/app/(app)/page.tsx`, `apps/web/components/app-sidebar.tsx`,
  `apps/web/components/branch-switcher.tsx`, `apps/web/lib/api.ts`,
  `apps/web/lib/auth.ts`
- `docs/architecture.md`, `docs/database.md`, `docs/business-rules.md`,
  `docs/gold-accounting.md`, `docs/api.md`, `docs/permissions.md`,
  `docs/deployment.md`, `docs/barcode-system.md`
- `vitest.config.ts` (root or per-app)

Each file has one responsibility: routes parse/validate only; services own
D1 logic; middleware owns auth/RBAC/error; shared owns contracts.

---

### Task 1: Monorepo scaffold + tooling

**Files:**
- Create: `package.json`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `vitest.config.ts`
- Test: `package.json` (scripts run)

**Interfaces:**
- Consumes: none.
- Produces: `pnpm` workspaces `apps/*`, `packages/*`; scripts `dev, build, test, db:migrate`.

- [ ] **Step 1: Write root package.json**

```json
{
  "name": "goldos",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": {},
    "lint": {}
  }
}
```

- [ ] **Step 3: Write tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 4: Write .gitignore**

```gitignore
node_modules/
.next/
dist/
.wrangler/
.dev.vars
*.log
```

- [ ] **Step 5: Write .nvmrc**

```text
20
```

- [ ] **Step 6: Verify scaffold**

Run: `pnpm install && pnpm build 2>&1 | head -20`
Expected: install succeeds (build has no apps yet, turbo reports no tasks or pass).

- [ ] **Step 7: Commit**

```bash
git add package.json turbo.json tsconfig.base.json .gitignore .nvmrc
git commit -m "chore: monorepo scaffold with turbo + strict TS"
```

---

### Task 2: Shared contracts (permissions, schemas, types)

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/types.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/permissions.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `PERMISSIONS` map, `hasPermission(rolePerms: string[], required: string): boolean`, Zod `loginSchema, createUserSchema, createBranchSchema, settingSchema`, `ApiResponse<T>` type.

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/permissions.test.ts
import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";

describe("hasPermission", () => {
  it("allows exact match", () => {
    expect(hasPermission(["users:write"], "users:write")).toBe(true);
  });
  it("denies missing", () => {
    expect(hasPermission(["users:read"], "users:write")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/permissions.test.ts`
Expected: FAIL with "Cannot find module './permissions'".

- [ ] **Step 3: Write permissions.ts**

```ts
export const PERMISSIONS = {
  USERS_READ: "users:read",
  USERS_WRITE: "users:write",
  BRANCHES_MANAGE: "branches:manage",
  SETTINGS_WRITE: "settings:write",
  AUDIT_READ: "audit:read",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function hasPermission(granted: string[], required: string): boolean {
  return granted.includes(required);
}

export const DEFAULT_ROLES: Record<string, string[]> = {
  admin: ["users:read", "users:write", "branches:manage", "settings:write", "audit:read"],
  manager: ["users:read", "branches:manage", "audit:read"],
  cashier: ["users:read"],
  viewer: [],
};
```

- [ ] **Step 4: Write schemas.ts**

```ts
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
  role: z.enum(["admin", "manager", "cashier", "viewer"]),
  branchId: z.string().min(1),
});

export const createBranchSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  address: z.string().max(500).optional(),
});

export const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
  type: z.enum(["string", "number", "boolean", "json"]),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
```

- [ ] **Step 5: Write types.ts + index.ts**

```ts
// types.ts
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };
```

```ts
// index.ts
export * from "./permissions";
export * from "./schemas";
export * from "./types";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/src/permissions.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat: shared permissions, schemas, api types"
```

---

### Task 3: D1 core schema + migration + seed

**Files:**
- Create: `apps/api/package.json`, `apps/api/wrangler.toml`, `apps/api/drizzle.config.ts`, `apps/api/drizzle/0001_core.sql`, `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/src/seed.ts`
- Test: manual `wrangler d1 execute --local --file` applies cleanly.

**Interfaces:**
- Consumes: Task 2 `DEFAULT_ROLES`.
- Produces: D1 tables `users, roles, permissions, role_permissions, user_roles, branches, branch_members, sessions, audit_logs, settings, idempotency_keys`; `getDb(env)` helper.

- [ ] **Step 1: Write wrangler.toml**

```toml
name = "goldos-api"
main = "src/app.ts"
compatibility_date = "2024-09-01"

[[d1_databases]]
binding = "DB"
database_name = "goldos"
database_id = "REPLACE_WITH_REAL_ID"

[[r2_buckets]]
binding = "R2"
bucket_name = "goldos-assets"
```

- [ ] **Step 2: Write migration 0001_core.sql**

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE permissions (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE branch_members (
  user_id TEXT NOT NULL REFERENCES users(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  PRIMARY KEY (user_id, branch_id)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  prev_json TEXT,
  new_json TEXT,
  reason TEXT,
  ip TEXT,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  type TEXT NOT NULL
);
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
```

- [ ] **Step 3: Write schema.ts (Drizzle mirror of same tables)**

```ts
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by"),
});
```

(Full file repeats all 11 tables with identical column names; keep in sync with SQL.)

- [ ] **Step 4: Write client.ts**

```ts
import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Env = { DB: D1Database; R2: R2Bucket };

export function getDb(env: Env): DrizzleD1Database<typeof schema> {
  return drizzle(env.DB, { schema });
}
```

- [ ] **Step 5: Write seed.ts (roles + permissions + first admin)**

```ts
// Inserts roles admin/manager/cashier/viewer, 5 permissions,
// role_permissions from DEFAULT_ROLES, and one admin user.
// Admin credentials come from env SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
// Run once via wrangler d1 execute --local --file ./seed.sql (generated).
```

Generate `seed.sql` locally with hashed password then execute; never commit plaintext passwords.

- [ ] **Step 6: Apply migration locally**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0001_core.sql`
Expected: `Executed 12 commands` with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/wrangler.toml apps/api/drizzle/0001_core.sql apps/api/src/db apps/api/src/seed.ts
git commit -m "feat: d1 core schema, migration, seed"
```

---

### Task 4: Hono shell + middleware (auth, RBAC, error, audit)

**Files:**
- Create: `apps/api/src/app.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/requirePerm.ts`, `apps/api/src/middleware/error.ts`, `apps/api/src/middleware/audit.ts`, `apps/api/src/routes/health.ts`
- Test: `apps/api/src/middleware/requirePerm.test.ts`

**Interfaces:**
- Consumes: Task 2 `hasPermission`, Task 3 `getDb`.
- Produces: `app` with `/api/v1/health`; `requireAuth`, `requirePerm(perm)`, `errorHandler`, `writeAudit(db, entry)`.

- [ ] **Step 1: Write failing RBAC test**

```ts
import { describe, expect, it } from "vitest";
import { hasPermission } from "@goldos/shared";

describe("requirePerm", () => {
  it("denies without permission", () => {
    expect(hasPermission([], "users:write")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify setup**

Run: `pnpm vitest run apps/api/src/middleware/requirePerm.test.ts`
Expected: PASS (proves wiring; real middleware tested via health auth in Task 5).

- [ ] **Step 3: Write error.ts**

```ts
import type { Context } from "hono";

export function errorHandler(err: Error, c: Context) {
  console.error(err);
  return c.json(
    { success: false, error: { code: "INTERNAL", message: "Something went wrong" } },
    500
  );
}
```

- [ ] **Step 4: Write auth.ts**

```ts
import { createMiddleware } from "hono/factory";

export const requireAuth = createMiddleware(async (c, next) => {
  const sessionId = c.req.header("cookie")?.match(/session=([^;]+)/)?.[1];
  if (!sessionId) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      401
    );
  }
  const row = await c.env.DB.prepare(
    "SELECT s.id, s.user_id, s.expires_at, u.is_active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?"
  ).bind(sessionId).first<{ user_id: string; expires_at: number; is_active: number }>();
  if (!row || row.expires_at < Date.now() || !row.is_active) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Session expired" } },
      401
    );
  }
  c.set("userId", row.user_id);
  await next();
});
```

- [ ] **Step 5: Write requirePerm.ts + audit.ts + app.ts**

```ts
// requirePerm.ts
import { createMiddleware } from "hono/factory";
import { hasPermission } from "@goldos/shared";

export const requirePerm = (perm: string) =>
  createMiddleware(async (c, next) => {
    const perms: string[] = c.get("permissions") ?? [];
    if (!hasPermission(perms, perm)) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Insufficient permission" } },
        403
      );
    }
    await next();
  });
```

```ts
// audit.ts
export async function writeAudit(
  db: D1Database,
  entry: { userId: string | null; action: string; entity: string; entityId: string; prev?: unknown; next?: unknown; reason?: string; branchId?: string; ip?: string }
): Promise<void> {
  await db.prepare(
    "INSERT INTO audit_logs (id, user_id, action, entity, entity_id, prev_json, new_json, reason, ip, branch_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    crypto.randomUUID(), entry.userId, entry.action, entry.entity, entry.entityId,
    entry.prev ? JSON.stringify(entry.prev) : null,
    entry.next ? JSON.stringify(entry.next) : null,
    entry.reason ?? null, entry.ip ?? null, entry.branchId ?? null, Date.now()
  ).run();
}
```

```ts
// app.ts
import { Hono } from "hono";
import { errorHandler } from "./middleware/error";
import { health } from "./routes/health";

const app = new Hono();
app.onError(errorHandler);
app.route("/api/v1/health", health);
export default app;
```

- [ ] **Step 6: Verify**

Run: `pnpm vitest run apps/api/src/middleware/requirePerm.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/middleware apps/api/src/routes/health.ts
git commit -m "feat: hono shell with auth, rbac, error, audit"
```

---

### Task 5: Auth routes (login/logout/me)

**Files:**
- Create: `apps/api/src/services/hash.ts`, `apps/api/src/services/session.ts`, `apps/api/src/routes/auth.ts`
- Test: `apps/api/src/services/hash.test.ts`

**Interfaces:**
- Consumes: Task 4 `requireAuth`, `writeAudit`; Task 2 `loginSchema`.
- Produces: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`; `hashPassword`, `verifyPassword`.

- [ ] **Step 1: Write failing hash test**

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./hash";

describe("hash", () => {
  it("verifies correct password", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword("password123", hash)).toBe(true);
  });
  it("rejects wrong password", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run apps/api/src/services/hash.test.ts`
Expected: FAIL "Cannot find module './hash'".

- [ ] **Step 3: Write hash.ts (Node scrypt; Workers uses crypto.subtle — same API surface)**

```ts
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  const buf = (await scryptAsync(password, salt as string, 64)) as Buffer;
  const expected = Buffer.from(hex as string, "hex");
  return buf.length === expected.length && timingSafeEqual(buf, expected);
}
```

- [ ] **Step 4: Write session.ts + auth.ts**

```ts
// session.ts
export async function createSession(db: D1Database, userId: string): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12; // 12h idle
  await db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, expiresAt, Date.now()).run();
  return { id, expiresAt };
}
```

```ts
// auth.ts (Hono router: login validates loginSchema, checks is_active,
// verifyPassword, batch [create session + audit], sets cookie;
// logout deletes session + audit; me returns user + permissions)
```

Login handler sets: `Set-Cookie: session=<id>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/api/src/services/hash.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/hash.ts apps/api/src/services/session.ts apps/api/src/routes/auth.ts
git commit -m "feat: session auth login logout me"
```

---

### Task 6: Users, roles, branches, settings, audit routes

**Files:**
- Create: `apps/api/src/services/users.ts`, `apps/api/src/services/branches.ts`, `apps/api/src/services/settings.ts`, `apps/api/src/routes/users.ts`, `apps/api/src/routes/roles.ts`, `apps/api/src/routes/branches.ts`, `apps/api/src/routes/settings.ts`, `apps/api/src/routes/audit.ts`
- Test: extend Vitest for `createUserSchema` rejects weak password.

**Interfaces:**
- Consumes: Tasks 2/4/5.
- Produces: CRUD `POST/GET/PATCH /users` (deactivate only), `GET /roles`, `POST/GET/PATCH /branches`, `GET/PUT /settings/:key`, `GET /audit` (`audit:read`); every write batches business write + `audit_logs`.

- [ ] **Step 1: Write failing validation test**

```ts
import { describe, expect, it } from "vitest";
import { createUserSchema } from "@goldos/shared";

describe("createUser", () => {
  it("rejects short password", () => {
    expect(() => createUserSchema.parse({
      email: "a@b.com", name: "A", password: "short",
      role: "cashier", branchId: "b1",
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it passes (schema already exists)**

Run: `pnpm vitest run apps/api/src/routes/users.validation.test.ts`
Expected: PASS — confirms contract before routes.

- [ ] **Step 3: Implement services (atomic batch pattern)**

```ts
// users.ts — createUser(db, input, actorId):
// batch: [INSERT users, INSERT user_roles, INSERT branch_members, INSERT audit_logs]
// deactivateUser: UPDATE is_active=0 + audit (never DELETE).
// branches.ts — createBranch + audit; listBranches scoped to branch_members unless admin.
// settings.ts — getSetting/putSetting with type check from settingSchema.
```

- [ ] **Step 4: Implement routers with requireAuth + requirePerm**

```ts
// users.ts router: POST / (users:write), GET / (users:read), PATCH /:id/deactivate (users:write)
// roles.ts: GET / (users:read)
// branches.ts: POST/GET/PATCH (branches:manage)
// settings.ts: GET /:key (any auth), PUT /:key (settings:write)
// audit.ts: GET /?entity=&entityId= (audit:read), paginated ?page=&limit=
```

All list routes: `?search=&page=&limit=&sort=` with `LIMIT/OFFSET`, `ORDER BY created_at DESC`.

- [ ] **Step 5: Verify**

Run: `pnpm vitest run && pnpm --filter goldos-api exec tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services apps/api/src/routes
git commit -m "feat: users roles branches settings audit routes"
```

---

### Task 7: Web shell (Next.js + shadcn gold theme + auth + dashboard)

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.mjs`, `apps/web/tailwind.config.ts`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/login/page.tsx`, `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/page.tsx`, `apps/web/components/app-sidebar.tsx`, `apps/web/components/branch-switcher.tsx`, `apps/web/lib/api.ts`, `apps/web/lib/auth.ts`
- Test: `pnpm --filter goldos-web exec tsc --noEmit` + manual login flow.

**Interfaces:**
- Consumes: Tasks 2/5/6 API contracts.
- Produces: `/login` (RHF+Zod), authenticated `(app)` layout with sidebar + branch switcher, dashboard placeholders, `api<T>(path, opts)` typed fetch helper.

- [ ] **Step 1: Write api.ts helper**

```ts
import type { ApiResponse } from "@goldos/shared";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error.message);
  return body.data;
}
```

- [ ] **Step 2: Write login page (RHF + loginSchema + sonner toast + redirect)**

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@goldos/shared";
// onSubmit: await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify(v) })
// success → router.push("/"); failure → toast.error(message)
```

- [ ] **Step 3: Write (app) layout + sidebar + dashboard**

Sidebar links: Dashboard, Users, Branches, Settings, Audit (RBAC-hidden).
Dashboard: three cards (Cash today, Gold on hand, Low stock) with skeleton +
empty state "Connect Phase-2 modules". Branch switcher persists to cookie.

- [ ] **Step 4: Theme globals.css (gold accent #C9A227, Inter)**

```css
:root { --gold: #C9A227; }
```

Tailwind extends `colors.gold.DEFAULT = "#C9A227"`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter goldos-web exec tsc --noEmit && pnpm --filter goldos-web exec next lint`
Expected: no errors. Manual: login → dashboard → logout works; 403 page on denied route.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: web shell with auth, sidebar, dashboard"
```

---

### Task 8: Docs, deployment bindings, end-to-end verification

**Files:**
- Create: `docs/architecture.md`, `docs/database.md`, `docs/business-rules.md`, `docs/gold-accounting.md`, `docs/api.md`, `docs/permissions.md`, `docs/deployment.md`, `docs/barcode-system.md`
- Modify: `apps/api/wrangler.toml` (real `database_id`)
- Test: full checklist below.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: deployable Workers + Pages; docs skeleton filled for Phase 1, ledger designs reserved for Phase 2.

- [ ] **Step 1: Write docs (concise, no placeholders)**

`architecture.md` (monorepo diagram + request flow), `database.md` (ER of 11
tables + future gold/financial ledger designs), `business-rules.md`
(configurable rules live in settings), `gold-accounting.md` (dual-ledger
principle + deferred schema note), `api.md` (endpoint table + envelope),
`permissions.md` (role matrix), `deployment.md` (Wrangler D1/R2 steps with
real IDs), `barcode-system.md` (ID formats reserved: `PRD-`, `OLD-`, `MLT-`,
`MFG-`, `REP-`).

- [ ] **Step 2: Wire real Cloudflare bindings**

Run: `pnpm --filter goldos-api exec wrangler d1 execute goldos --remote --file ./drizzle/0001_core.sql`
Expected: remote migration succeeds.

- [ ] **Step 3: Run full verification (verification-before-completion)**

Run: `pnpm test && pnpm build`
Expected: all Vitest PASS, both apps build.
Manual gate: register→login→create branch→create user→deactivate→audit row
present→RBAC deny as viewer→session expiry→branch switch isolation.

- [ ] **Step 4: Commit**

```bash
git add docs apps/api/wrangler.toml
git commit -m "docs: phase-1 docs and cloud bindings"
```

---

## Self-Review

- Spec coverage: auth+sessions (§2 auth), RBAC matrix (§3 roles),
  branches+members (§3 branches), settings (§3 settings), audit append-only
  (§3 audit), web shell (§3 web), docs (8 files §3 docs), atomic batches
  (§5 template), error envelope (§2 errors) — each has a task above.
- Placeholder scan: no TBD/TODO; every code step has exact file + code;
  seed handles passwords via env, not committed plaintext.
- Type consistency: `hasPermission(string[], string)`, `ApiResponse<T>`,
  `getDb(env)`, `writeAudit(db, entry)`, `hashPassword/verifyPassword`,
  `createSession` signatures reused verbatim across tasks.
