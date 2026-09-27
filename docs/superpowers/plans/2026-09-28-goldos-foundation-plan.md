# GoldOS Foundation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the platform foundation — 8 roles with full domain×action matrix, password change + token reset, user edit/activity, branch settings, upgraded shell, honest dashboard, audited everything — migrated and deployed.

**Architecture:** Single migration `0004_foundation` (new roles/perms/grants, user_roles remap, old rows removed, `password_resets` table). Route guards rewritten to `domain:action` names; `requirePerm` untouched (string compare, never role names). Sessions load permissions dynamically, so no session invalidation on remap. Every new write batched with audit.

**Tech Stack:** Hono, Drizzle, D1, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler.

## Global Constraints

- Every write batches business row + audit_logs; failure rolls back.
- No hard deletes; activate/deactivate/void with reason where applicable.
- Strict TypeScript, no `any`; Zod client + server; typed `{ success, data, error }` responses.
- Branch keys in settings use `branch.{id}.{key}` format.
- Reset tokens: 32 random bytes hex, only SHA-256 hash stored, 15-min expiry, single-use, confirm destroys all user sessions.
- `reverse` action reserved for future transaction modules (sales/purchases/old-gold); not seeded now.
- Old role names (admin/manager/cashier/viewer) and old perm names (`users:read` etc.) cease to exist after migration.

---

## Permission matrix (SINGLE SOURCE OF TRUTH — migration, DEFAULT_ROLES, seed, and test must match exactly)

Seeded permissions (28):
users:view, users:create, users:edit, users:approve, users:cancel, users:export,
roles:view, roles:manage,
branches:view, branches:create, branches:edit, branches:approve, branches:manage,
settings:view, settings:edit, settings:manage,
audit:view, audit:export,
masters:view, masters:create, masters:edit, masters:cancel, masters:export,
products:view, products:create, products:edit, products:cancel, products:export

Grants:
- owner: all 28.
- manager: all except users:approve and branches:approve (27).
- accountant: users:view, roles:view, branches:view, settings:view, audit:view, audit:export, masters:view, masters:export, products:view, products:export (10).
- cashier: users:view, branches:view, masters:view, products:view (4).
- salesperson: branches:view, masters:view, products:view (3).
- inventory_officer: branches:view, masters:view, masters:create, masters:edit, masters:cancel, masters:export, products:view, products:create, products:edit, products:cancel, products:export (11).
- gold_officer: branches:view, masters:view, masters:create, masters:export, products:view (5).
- manufacturing_staff: products:view (1).

## Guard mapping (exact — no deviations)

- POST /users → users:create; GET /users → users:view; PATCH /users/:id (name/branches) → users:edit; role change inside edit → additionally users:approve; PATCH activate/deactivate → users:edit + reason.
- GET /roles → roles:view.
- POST /branches → branches:create; GET /branches → branches:view (keep member scoping); PATCH /branches/:id → branches:edit.
- GET /settings/:key → settings:view; PUT /settings/:key → settings:edit, or settings:manage when key starts with `branch.`.
- GET /audit → audit:view (+ optional `?userId=` filter); export is a client-side CSV button gated by audit:export.
- Masters: POST (catalog/parties/rates) → masters:create; GET → masters:view; catalog deactivate + parties PATCH with isActive=0 → masters:cancel; other parties PATCH → masters:edit.
- Products: POST → products:create; GET/detail/barcode/label → products:view; void → products:cancel.
- Auth: change-password → any authenticated user (self only); reset-request → users:edit; reset-confirm → public.

## File Structure

- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/foundation.test.ts`
- Create: `apps/api/drizzle/0004_foundation.sql`
- Modify: `apps/api/src/db/schema.ts` (append password_resets), `apps/api/src/seed.ts`
- Create: `apps/api/src/services/password.ts`
- Modify: `apps/api/src/routes/auth.ts` (append 3 routes), `apps/api/src/services/users.ts` (edit/activate/get), `apps/api/src/routes/users.ts` (rewrite), `apps/api/src/routes/roles.ts`, `apps/api/src/routes/audit.ts` (userId filter), `apps/api/src/routes/settings.ts`, `apps/api/src/routes/branches.ts`, `apps/api/src/routes/catalog.ts`, `apps/api/src/routes/parties.ts`, `apps/api/src/routes/rates.ts`, `apps/api/src/routes/products.ts`, `apps/web/components/app-sidebar.tsx`
- Create web: `apps/web/app/(app)/users/page.tsx`, `apps/web/app/(app)/branches/page.tsx`, `apps/web/app/(app)/settings/page.tsx`, `apps/web/app/(app)/audit/page.tsx`, `apps/web/components/breadcrumbs.tsx`, `apps/web/components/user-menu.tsx`, `apps/web/app/(app)/error.tsx`
- Modify web: `apps/web/app/(app)/layout.tsx` (header upgrade), `apps/web/app/(app)/page.tsx` (8 cards)
- Modify docs: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/architecture.md` (if it lists roles)

---

### Task 1: Shared permissions, roles, schemas

**Files:**
- Modify: `packages/shared/src/permissions.ts` (full rewrite)
- Modify: `packages/shared/src/schemas.ts` (append + edit role enum)
- Create: `packages/shared/src/foundation.test.ts`
- Test: `packages/shared/src/foundation.test.ts`

**Interfaces:**
- Consumes: existing `z`, `hasPermission` shape.
- Produces: new `PERMISSIONS` (28 keys), `DEFAULT_ROLES` (8 roles, exact matrix), `changePasswordSchema`, `resetRequestSchema`, `resetConfirmSchema`, `editUserSchema` (+ types). Note: `createUserSchema` role enum changes to the 8 new ids and `branchId` → `branchIds: z.array(z.string().min(1)).min(1)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/foundation.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";
import { changePasswordSchema, editUserSchema } from "./schemas";

describe("foundation matrix", () => {
  it("owner has every seeded permission", () => {
    const all = Object.values(PERMISSIONS);
    for (const p of all) expect(DEFAULT_ROLES["owner"]).toContain(p);
  });
  it("manufacturing_staff has only products:view", () => {
    expect(DEFAULT_ROLES["manufacturing_staff"]).toEqual(["products:view"]);
  });
  it("manager cannot approve users", () => {
    expect(DEFAULT_ROLES["manager"]).not.toContain("users:approve");
  });
  it("rejects short new password", () => {
    expect(() =>
      changePasswordSchema.parse({ currentPassword: "oldpass12", newPassword: "short" })
    ).toThrow();
  });
  it("editUser accepts role change payload", () => {
    const v = editUserSchema.parse({ role: "gold_officer", branchIds: ["b1"] });
    expect(v.role).toBe("gold_officer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/foundation.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Rewrite packages/shared/src/permissions.ts**

```ts
export const PERMISSIONS = {
  USERS_VIEW: "users:view",
  USERS_CREATE: "users:create",
  USERS_EDIT: "users:edit",
  USERS_APPROVE: "users:approve",
  USERS_CANCEL: "users:cancel",
  USERS_EXPORT: "users:export",
  ROLES_VIEW: "roles:view",
  ROLES_MANAGE: "roles:manage",
  BRANCHES_VIEW: "branches:view",
  BRANCHES_CREATE: "branches:create",
  BRANCHES_EDIT: "branches:edit",
  BRANCHES_APPROVE: "branches:approve",
  BRANCHES_MANAGE: "branches:manage",
  SETTINGS_VIEW: "settings:view",
  SETTINGS_EDIT: "settings:edit",
  SETTINGS_MANAGE: "settings:manage",
  AUDIT_VIEW: "audit:view",
  AUDIT_EXPORT: "audit:export",
  MASTERS_VIEW: "masters:view",
  MASTERS_CREATE: "masters:create",
  MASTERS_EDIT: "masters:edit",
  MASTERS_CANCEL: "masters:cancel",
  MASTERS_EXPORT: "masters:export",
  PRODUCTS_VIEW: "products:view",
  PRODUCTS_CREATE: "products:create",
  PRODUCTS_EDIT: "products:edit",
  PRODUCTS_CANCEL: "products:cancel",
  PRODUCTS_EXPORT: "products:export",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function hasPermission(granted: string[], required: string): boolean {
  return granted.includes(required);
}

const ALL = Object.values(PERMISSIONS);

export const DEFAULT_ROLES: Record<string, string[]> = {
  owner: [...ALL],
  manager: ALL.filter((p) => p !== "users:approve" && p !== "branches:approve"),
  accountant: [
    "users:view", "roles:view", "branches:view", "settings:view",
    "audit:view", "audit:export", "masters:view", "masters:export",
    "products:view", "products:export",
  ],
  cashier: ["users:view", "branches:view", "masters:view", "products:view"],
  salesperson: ["branches:view", "masters:view", "products:view"],
  inventory_officer: [
    "branches:view", "masters:view", "masters:create", "masters:edit",
    "masters:cancel", "masters:export", "products:view", "products:create",
    "products:edit", "products:cancel", "products:export",
  ],
  gold_officer: ["branches:view", "masters:view", "masters:create", "masters:export", "products:view"],
  manufacturing_staff: ["products:view"],
};
```

Note: old keys (USERS_READ etc.) are deleted. Every route file referencing them will fail typecheck until Task 5 — intended; Tasks 2–5 fix all references. Do NOT leave stragglers: after Task 5, `grep -rn "USERS_READ\|USERS_WRITE\|BRANCHES_MANAGE\|SETTINGS_WRITE\|AUDIT_READ\|MASTERS_READ\|MASTERS_WRITE\|PRODUCTS_READ\|PRODUCTS_WRITE" apps packages --include="*.ts" --include="*.tsx"` must return zero hits (excluding specs/plans docs).

- [ ] **Step 4: Edit packages/shared/src/schemas.ts**

Change `createUserSchema` role enum + branch:
```ts
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
  role: z.enum(["owner", "manager", "accountant", "cashier", "salesperson", "inventory_officer", "gold_officer", "manufacturing_staff"]),
  branchIds: z.array(z.string().min(1)).min(1),
});
```
Append:
```ts
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const resetRequestSchema = z.object({
  email: z.string().email(),
});

export const resetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export const editUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(["owner", "manager", "accountant", "cashier", "salesperson", "inventory_officer", "gold_officer", "manufacturing_staff"]).optional(),
  branchIds: z.array(z.string().min(1)).min(1).optional(),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type EditUserInput = z.infer<typeof editUserSchema>;
```

- [ ] **Step 5: Run test + typecheck shared only**

Run: `pnpm exec vitest run packages/shared/src/foundation.test.ts 2>&1 | tail -3`
Expected: 5 passed.
(API/web typecheck will fail until guards rewritten — expected, fix in Tasks 3–5 + 7.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/permissions.ts packages/shared/src/schemas.ts packages/shared/src/foundation.test.ts
git commit -m "feat: 8-role matrix and foundation schemas"
```

---

### Task 2: Migration 0004 + seed + drizzle

**Files:**
- Create: `apps/api/drizzle/0004_foundation.sql`
- Modify: `apps/api/src/db/schema.ts` (append password_resets)
- Modify: `apps/api/src/seed.ts` (roles + perms + grants)
- Test: local apply, role/perm counts, remap check

**Interfaces:**
- Consumes: Task 1 matrix (must match exactly).
- Produces: remote+local `password_resets` table; 8 roles; 28 perms; remapped memberships.

- [ ] **Step 1: Write apps/api/drizzle/0004_foundation.sql**

```sql
CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
INSERT INTO roles (id, name) VALUES
  ('owner', 'owner'),
  ('accountant', 'accountant'),
  ('salesperson', 'salesperson'),
  ('inventory_officer', 'inventory_officer'),
  ('gold_officer', 'gold_officer'),
  ('manufacturing_staff', 'manufacturing_staff');
INSERT INTO permissions (id, name) VALUES
  ('users:view', 'users:view'), ('users:create', 'users:create'),
  ('users:edit', 'users:edit'), ('users:approve', 'users:approve'),
  ('users:cancel', 'users:cancel'), ('users:export', 'users:export'),
  ('roles:view', 'roles:view'), ('roles:manage', 'roles:manage'),
  ('branches:view', 'branches:view'), ('branches:create', 'branches:create'),
  ('branches:edit', 'branches:edit'), ('branches:approve', 'branches:approve'),
  ('branches:manage', 'branches:manage'),
  ('settings:view', 'settings:view'), ('settings:edit', 'settings:edit'),
  ('settings:manage', 'settings:manage'),
  ('audit:view', 'audit:view'), ('audit:export', 'audit:export'),
  ('masters:view', 'masters:view'), ('masters:create', 'masters:create'),
  ('masters:edit', 'masters:edit'), ('masters:cancel', 'masters:cancel'),
  ('masters:export', 'masters:export'),
  ('products:view', 'products:view'), ('products:create', 'products:create'),
  ('products:edit', 'products:edit'), ('products:cancel', 'products:cancel'),
  ('products:export', 'products:export');
UPDATE user_roles SET role_id = 'owner' WHERE role_id = 'admin';
UPDATE user_roles SET role_id = 'salesperson' WHERE role_id = 'viewer';
DELETE FROM role_permissions WHERE role_id IN ('admin', 'manager', 'cashier', 'viewer');
DELETE FROM roles WHERE id IN ('admin', 'viewer');
DELETE FROM role_permissions WHERE permission_id IN (
  'users:read', 'users:write', 'branches:manage', 'settings:write',
  'audit:read', 'masters:read', 'masters:write', 'products:read', 'products:write'
);
DELETE FROM permissions WHERE id IN (
  'users:read', 'users:write', 'branches:manage', 'settings:write',
  'audit:read', 'masters:read', 'masters:write', 'products:read', 'products:write'
);
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions;
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id NOT IN ('users:approve', 'branches:approve');
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'users:view'), ('accountant', 'roles:view'),
  ('accountant', 'branches:view'), ('accountant', 'settings:view'),
  ('accountant', 'audit:view'), ('accountant', 'audit:export'),
  ('accountant', 'masters:view'), ('accountant', 'masters:export'),
  ('accountant', 'products:view'), ('accountant', 'products:export'),
  ('cashier', 'users:view'), ('cashier', 'branches:view'),
  ('cashier', 'masters:view'), ('cashier', 'products:view'),
  ('salesperson', 'branches:view'), ('salesperson', 'masters:view'),
  ('salesperson', 'products:view'),
  ('inventory_officer', 'branches:view'),
  ('inventory_officer', 'masters:view'), ('inventory_officer', 'masters:create'),
  ('inventory_officer', 'masters:edit'), ('inventory_officer', 'masters:cancel'),
  ('inventory_officer', 'masters:export'),
  ('inventory_officer', 'products:view'), ('inventory_officer', 'products:create'),
  ('inventory_officer', 'products:edit'), ('inventory_officer', 'products:cancel'),
  ('inventory_officer', 'products:export'),
  ('gold_officer', 'branches:view'), ('gold_officer', 'masters:view'),
  ('gold_officer', 'masters:create'), ('gold_officer', 'masters:export'),
  ('gold_officer', 'products:view'),
  ('manufacturing_staff', 'products:view');
```

Why this order: new roles first (manager/cashier ids already exist — no insert for them); remap memberships while old role rows still exist; wipe old grants; delete orphaned old roles (admin/viewer) — manager/cashier rows stay with new grant sets; delete old perm rows; then insert new grants. `manager`/`cashier` user_roles rows need no change (same ids).

- [ ] **Step 2: Append Drizzle password_resets + rewrite seed.ts roles/perms**

Drizzle append:
```ts
export const passwordResets = sqliteTable("password_resets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});
```
seed.ts: SEED_ROLES = owner/manager/accountant/cashier/salesperson/inventory_officer/gold_officer/manufacturing_staff; SEED_PERMISSIONS = the 28 names; SEED_ROLE_PERMISSIONS = exact matrix from plan header.

- [ ] **Step 3: Apply local, verify counts + remap**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0004_foundation.sql 2>&1 | grep -E "success|ERROR" | head -2`
Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --command "SELECT COUNT(*) AS roles FROM roles; SELECT COUNT(*) AS perms FROM permissions; SELECT role_id, COUNT(*) AS g FROM role_permissions GROUP BY role_id ORDER BY role_id; SELECT * FROM user_roles;" 2>&1 | grep -E '"roles"|"perms"|"role_id"|"user_id"'`
Expected: roles 8, perms 28, owner 28 / manager 27 / manufacturing_staff 1, admin-1 now owner. (Local test users cashier2/cashier3 remap to same ids — unchanged.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0004_foundation.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: foundation migration with 8 roles and matrix"
```

---

### Task 3: Password service + auth routes

**Files:**
- Create: `apps/api/src/services/password.ts`
- Modify: `apps/api/src/routes/auth.ts` (append 3 routes)
- Test: typecheck (live-tested in Task 6)

**Interfaces:**
- Consumes: `hashPassword` from `./hash`; `buildAuditStmt`; new schemas.
- Produces: `changePassword, requestReset, confirmReset`; routes `POST /auth/change-password`, `POST /auth/reset-request`, `POST /auth/reset-confirm`.

- [ ] **Step 1: Write apps/api/src/services/password.ts**

```ts
import { buildAuditStmt } from "../middleware/audit";
import { hashPassword, verifyPassword } from "./hash";

const RESET_TTL_MS = 15 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function changePassword(
  db: D1Database,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db
    .prepare("SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1")
    .bind(userId)
    .first<{ id: string; password_hash: string }>();
  if (!user) throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) throw Object.assign(new Error("Current password is incorrect"), { code: "UNAUTHORIZED" });
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(newPassword), now, userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    buildAuditStmt(db, { userId, action: "auth.password_change", entity: "user", entityId: userId }),
  ]);
}
```

Note: DELETE sessions logs the caller out too — caller re-logs in with new password. Document in route response message.

```ts
export async function requestReset(db: D1Database, email: string, actorId: string): Promise<{ token: string; userId: string }> {
  const user = await db
    .prepare("SELECT id, is_active FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; is_active: number }>();
  if (!user || !user.is_active) throw Object.assign(new Error("User not found or inactive"), { code: "NOT_FOUND" });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, user.id, await sha256Hex(token), now + RESET_TTL_MS, now, actorId),
    buildAuditStmt(db, { userId: actorId, action: "auth.reset_request", entity: "user", entityId: user.id }),
  ]);
  return { token, userId: user.id };
}

export async function confirmReset(db: D1Database, token: string, newPassword: string): Promise<void> {
  const row = await db
    .prepare("SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null }>();
  if (!row || row.used_at || row.expires_at < Date.now())
    throw Object.assign(new Error("Invalid or expired reset token"), { code: "UNAUTHORIZED" });
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(newPassword), now, row.user_id),
    db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").bind(now, row.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
    buildAuditStmt(db, { userId: row.user_id, action: "auth.reset_confirm", entity: "user", entityId: row.user_id }),
  ]);
}
```

- [ ] **Step 2: Append routes to apps/api/src/routes/auth.ts**

Imports to add: `changePasswordSchema, resetRequestSchema, resetConfirmSchema, PERMISSIONS` from shared; `requirePerm`; `changePassword, requestReset, confirmReset` from services.
Routes (chain onto existing `auth` router — add after `.get("/me", ...)` block, before the closing semicolon; restructure: change `});` ending `/me` to `})` and append):

```ts
  .post("/change-password", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid password data" } }, 400);
    try {
      await changePassword(c.env.DB, c.get("userId"), parsed.data.currentPassword, parsed.data.newPassword);
      c.header("Set-Cookie", sessionCookie("", 0));
      return c.json({ success: true, data: { ok: true, relogin: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/reset-request", requireAuth, requirePerm(PERMISSIONS.USERS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = resetRequestSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid email" } }, 400);
    try {
      const { token, userId } = await requestReset(c.env.DB, parsed.data.email, c.get("userId"));
      return c.json({ success: true, data: { userId, token, expiresInMinutes: 15, deliverSecurely: true } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/reset-confirm", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = resetConfirmSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid reset data" } }, 400);
    try {
      await confirmReset(c.env.DB, parsed.data.token, parsed.data.newPassword);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
```

Also import `serviceError` from `./http` in auth.ts. Note `sessionCookie` is module-private — reuse for clearing. Careful with the existing `.get("/me", ...)` terminator when editing.

- [ ] **Step 3: Typecheck (expect failures in other route files — that's Task 5)**

Run: `pnpm --filter goldos-api exec tsc --noEmit 2>&1 | grep -v "USERS_READ\|USERS_WRITE\|MASTERS_READ\|MASTERS_WRITE\|PRODUCTS_READ\|PRODUCTS_WRITE\|BRANCHES_MANAGE\|SETTINGS_WRITE\|AUDIT_READ" | head -10`
Expected: no output (only old-perm-name errors remain).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/password.ts apps/api/src/routes/auth.ts
git commit -m "feat: password change and token reset"
```

---

### Task 4: Users rewrite + roles + audit filter + settings tighten

**Files:**
- Modify: `apps/api/src/services/users.ts` (add editUser, activateUser, getUser; update createUser for branchIds)
- Modify: `apps/api/src/routes/users.ts` (full rewrite with new guards)
- Modify: `apps/api/src/routes/roles.ts` (roles:view)
- Modify: `apps/api/src/routes/audit.ts` (userId filter)
- Modify: `apps/api/src/routes/settings.ts` (settings:view on GET; manage for branch. keys)
- Test: typecheck scoped to these files

**Interfaces:**
- Consumes: Task 1 schemas/perms; `hashPassword`; `buildAuditStmt`.
- Produces: `editUser, activateUser, getUserDetail`; routes per guard mapping; audit `?userId=`.

- [ ] **Step 1: Rewrite createUser for branchIds + add editUser/activateUser/getUserDetail**

Replace `input.branchId` usage: validate all ids exist+active; batch INSERT user + user_roles + N branch_members + audit (next includes role + branchIds).
New functions (exact code):

```ts
import type { CreateUserInput, EditUserInput } from "@goldos/shared";

export type UserDetail = {
  id: string; email: string; name: string; is_active: number; created_at: number;
  roles: string[]; branchIds: string[];
};

export async function getUserDetail(db: D1Database, id: string): Promise<UserDetail> {
  const user = await db
    .prepare("SELECT id, email, name, is_active, created_at FROM users WHERE id = ?")
    .bind(id)
    .first<Omit<UserDetail, "roles" | "branchIds">>();
  if (!user) throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
  const { results: roleRows } = await db.prepare("SELECT role_id FROM user_roles WHERE user_id = ?").bind(id).all<{ role_id: string }>();
  const { results: branchRows } = await db.prepare("SELECT branch_id FROM branch_members WHERE user_id = ?").bind(id).all<{ branch_id: string }>();
  return { ...user, roles: (roleRows ?? []).map((r) => r.role_id), branchIds: (branchRows ?? []).map((b) => b.branch_id) };
}

export async function editUser(db: D1Database, id: string, patch: EditUserInput, actorId: string): Promise<void> {
  const prev = await getUserDetail(db, id);
  if (id === actorId && patch.role !== undefined)
    throw Object.assign(new Error("Cannot change your own role"), { code: "CONFLICT" });
  if (patch.role !== undefined) {
    const perms = await db
      .prepare(`SELECT p.name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`)
      .bind(actorId).all<{ name: string }>();
    const granted = new Set((perms.results ?? []).map((r) => r.name));
    if (!granted.has("users:approve"))
      throw Object.assign(new Error("Changing roles requires users:approve"), { code: "FORBIDDEN" });
    const roleExists = await db.prepare("SELECT id FROM roles WHERE id = ?").bind(patch.role).first();
    if (!roleExists) throw Object.assign(new Error("Role not found"), { code: "NOT_FOUND" });
  }
  if (patch.branchIds !== undefined) {
    for (const b of patch.branchIds) {
      const br = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(b).first();
      if (!br) throw Object.assign(new Error(`Branch not found: ${b}`), { code: "NOT_FOUND" });
    }
  }
  const stmts: D1PreparedStatement[] = [];
  if (patch.name !== undefined) stmts.push(db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").bind(patch.name, Date.now(), id));
  if (patch.role !== undefined) {
    stmts.push(db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(id));
    stmts.push(db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(id, patch.role));
  }
  if (patch.branchIds !== undefined) {
    stmts.push(db.prepare("DELETE FROM branch_members WHERE user_id = ?").bind(id));
    for (const b of patch.branchIds) stmts.push(db.prepare("INSERT INTO branch_members (user_id, branch_id) VALUES (?, ?)").bind(id, b));
  }
  if (stmts.length === 0) return;
  stmts.push(buildAuditStmt(db, {
    userId: actorId, action: "user.edit", entity: "user", entityId: id,
    prev: { name: prev.name, roles: prev.roles, branchIds: prev.branchIds }, next: patch,
  }));
  await db.batch(stmts);
}

export async function activateUser(db: D1Database, id: string, actorId: string, reason: string): Promise<void> {
  const prev = await db.prepare("SELECT id, is_active FROM users WHERE id = ?").bind(id).first<{ id: string; is_active: number }>();
  if (!prev) throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
  if (id === actorId) throw Object.assign(new Error("Cannot change your own activation"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?").bind(Date.now(), id),
    buildAuditStmt(db, { userId: actorId, action: "user.activate", entity: "user", entityId: id, prev: { is_active: prev.is_active }, next: { is_active: 1 }, reason }),
  ]);
}
```

Also update deactivateUser self-check message unchanged; keep. Update createUser: replace single-branch check/insert with loop over input.branchIds; audit next.branchIds.

- [ ] **Step 2: Rewrite apps/api/src/routes/users.ts**

```ts
import 
...[truncated 15802 chars]