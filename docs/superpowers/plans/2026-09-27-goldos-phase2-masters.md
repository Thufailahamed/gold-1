# GoldOS Phase-2 Masters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 5 master domains (categories, purities, gold rates, suppliers, customers) with API, UI, permissions, seed data, and docs.

**Architecture:** Dedicated module per master, following Phase-1 conventions exactly: shared Zod schemas, services own D1, every write in one `db.batch([...])` with its `audit_logs` row, paginated `?search=&page=&limit=` lists, `{ success, data }` envelope. Migration `0002_masters` (never touch `0001_core`).

**Tech Stack:** Hono, Drizzle ORM, Cloudflare D1, Next.js 16 App Router, React 19, TanStack Query v5, RHF + Zod, Tailwind.

## Global Constraints

- Every write batches business row + audit_logs; if audit fails the mutation fails.
- No hard deletes; deactivate with reason where applicable; gold_rates immutable (no UPDATE/DELETE routes).
- Strict TypeScript, no `any`; Zod client + server; typed API responses.
- Suppliers/customers carry `branch_id`; purities/rates/categories are global.
- New permissions `masters:read`, `masters:write`; admin+manager both, cashier read, viewer none.
- Never hard-code rates, purities, charges, categories; they live in D1 (or settings).

---

## File Structure

- Modify: `packages/shared/src/schemas.ts` (append masters schemas), `packages/shared/src/permissions.ts` (append perms + role defaults)
- Create: `packages/shared/src/masters.test.ts`
- Create: `apps/api/drizzle/0002_masters.sql`
- Modify: `apps/api/src/db/schema.ts` (append 5 tables), `apps/api/src/seed.ts` (masters perms), `apps/api/src/app.ts` (mount 3 routers)
- Create: `apps/api/src/services/catalog.ts`, `apps/api/src/services/rates.ts`, `apps/api/src/services/parties.ts`
- Create: `apps/api/src/routes/catalog.ts`, `apps/api/src/routes/rates.ts`, `apps/api/src/routes/parties.ts`
- Create: `apps/web/components/providers.tsx`, `apps/web/components/master-crud.tsx`
- Modify: `apps/web/app/(app)/layout.tsx` (wrap providers), `apps/web/components/app-sidebar.tsx` (5 links)
- Create: `apps/web/app/(app)/categories/page.tsx`, `purities/page.tsx`, `gold-rates/page.tsx`, `suppliers/page.tsx`, `customers/page.tsx`
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`

Each file has one responsibility: `catalog.ts` = categories + purities logic; `rates.ts` = gold-rate logic; `parties.ts` = suppliers + customers logic (shared `createPartySchema`, table name param).

---

### Task 1: Shared masters schemas + permissions

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append at end)
- Modify: `packages/shared/src/permissions.ts` (3 edits)
- Create: `packages/shared/src/masters.test.ts`
- Test: `packages/shared/src/masters.test.ts`

**Interfaces:**
- Consumes: existing `z` import in schemas.ts; `PERMISSIONS`, `DEFAULT_ROLES` in permissions.ts.
- Produces: `createCategorySchema, createPuritySchema, createGoldRateSchema, createPartySchema` (+ inferred types `CreateCategoryInput` etc.); `PERMISSIONS.MASTERS_READ/MASTERS_WRITE`; updated `DEFAULT_ROLES`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/masters.test.ts
import { describe, expect, it } from "vitest";
import { hasPermission } from "./permissions";
import { createGoldRateSchema, createPartySchema, createPuritySchema } from "./schemas";

describe("masters schemas", () => {
  it("rejects purity above 1", () => {
    expect(() =>
      createPuritySchema.parse({ karat: "22K", purity: 1.5 })
    ).toThrow();
  });
  it("rejects negative credit limit", () => {
    expect(() =>
      createPartySchema.parse({ name: "X", creditLimit: -5 })
    ).toThrow();
  });
  it("rejects zero gold rate", () => {
    expect(() =>
      createGoldRateSchema.parse({ purityId: "p1", ratePerGram: 0, effectiveFrom: Date.now() })
    ).toThrow();
  });
  it("grants masters:write to admin only (not cashier)", () => {
    expect(hasPermission(["users:read", "masters:read"], "masters:write")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/masters.test.ts`
Expected: FAIL with "Cannot find module './schemas'" (or missing export).

- [ ] **Step 3: Append schemas to packages/shared/src/schemas.ts**

```ts
export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  description: z.string().max(500).optional(),
});

export const createPuritySchema = z.object({
  karat: z.string().min(1).max(10),
  purity: z.number().gt(0).lte(1),
  defaultMakingCharge: z.number().min(0).optional().default(0),
  defaultWastagePct: z.number().min(0).max(100).optional().default(0),
});

export const createGoldRateSchema = z.object({
  purityId: z.string().min(1),
  ratePerGram: z.number().gt(0),
  effectiveFrom: z.number().int().positive(),
});

export const createPartySchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  nic: z.string().max(20).optional(),
  creditLimit: z.number().min(0).optional().default(0),
  openingBalance: z.number().optional().default(0),
  branchId: z.string().min(1),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreatePurityInput = z.infer<typeof createPuritySchema>;
export type CreateGoldRateInput = z.infer<typeof createGoldRateSchema>;
export type CreatePartyInput = z.infer<typeof createPartySchema>;
```

- [ ] **Step 4: Edit packages/shared/src/permissions.ts**

Edit 1 — append to PERMISSIONS object:
```ts
  MASTERS_READ: "masters:read",
  MASTERS_WRITE: "masters:write",
```

Edit 2 — admin role: `"admin": ["users:read", "users:write", "branches:manage", "settings:write", "audit:read", "masters:read", "masters:write"],`

Edit 3 — manager and cashier roles:
```ts
  manager: ["users:read", "branches:manage", "audit:read", "masters:read", "masters:write"],
  cashier: ["users:read", "masters:read"],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/masters.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/permissions.ts packages/shared/src/masters.test.ts
git commit -m "feat: masters schemas and permissions"
```

---

### Task 2: Migration 0002 + Drizzle schema + seed updates

**Files:**
- Create: `apps/api/drizzle/0002_masters.sql`
- Modify: `apps/api/src/db/schema.ts` (append 5 tables)
- Modify: `apps/api/src/seed.ts` (permissions + role grants)
- Test: local D1 apply + table check

**Interfaces:**
- Consumes: Task 1 permission strings (`masters:read`, `masters:write`).
- Produces: D1 tables `categories, purities, gold_rates, suppliers, customers`; Drizzle table exports of the same names; updated `SEED_PERMISSIONS`, `SEED_ROLE_PERMISSIONS`.

- [ ] **Step 1: Write apps/api/drizzle/0002_masters.sql**

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE purities (
  id TEXT PRIMARY KEY,
  karat TEXT NOT NULL UNIQUE,
  purity REAL NOT NULL,
  default_making_charge REAL NOT NULL DEFAULT 0,
  default_wastage_pct REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE gold_rates (
  id TEXT PRIMARY KEY,
  purity_id TEXT NOT NULL REFERENCES purities(id),
  rate_per_gram REAL NOT NULL,
  effective_from INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  UNIQUE (purity_id, effective_from)
);
CREATE INDEX idx_gold_rates_current ON gold_rates(purity_id, effective_from DESC);
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  nic TEXT UNIQUE,
  credit_limit REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  nic TEXT UNIQUE,
  credit_limit REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO permissions (id, name) VALUES ('masters:read', 'masters:read'), ('masters:write', 'masters:write');
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'masters:read'), ('admin', 'masters:write'),
  ('manager', 'masters:read'), ('manager', 'masters:write'),
  ('cashier', 'masters:read');
INSERT INTO purities (id, karat, purity, created_at) VALUES
  ('purity-24k', '24K', 1.0, 1759000000000),
  ('purity-22k', '22K', 0.916, 1759000000000),
  ('purity-21k', '21K', 0.875, 1759000000000),
  ('purity-18k', '18K', 0.75, 1759000000000);
INSERT INTO categories (id, name, code, created_at) VALUES
  ('cat-ring', 'Ring', 'RING', 1759000000000),
  ('cat-chain', 'Chain', 'CHAIN', 1759000000000),
  ('cat-bangle', 'Bangle', 'BANGLE', 1759000000000),
  ('cat-earring', 'Earring', 'EARRING', 1759000000000),
  ('cat-pendant', 'Pendant', 'PENDANT', 1759000000000),
  ('cat-necklace', 'Necklace', 'NECKLACE', 1759000000000);
```

- [ ] **Step 2: Append Drizzle tables to apps/api/src/db/schema.ts**

```ts
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  description: text("description"),
  isActive: integer("is_active").notNull().default(1),
  branchId: text("branch_id"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const purities = sqliteTable("purities", {
  id: text("id").primaryKey(),
  karat: text("karat").notNull().unique(),
  purity: real("purity").notNull(),
  defaultMakingCharge: real("default_making_charge").notNull().default(0),
  defaultWastagePct: real("default_wastage_pct").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});

export const goldRates = sqliteTable("gold_rates", {
  id: text("id").primaryKey(),
  purityId: text("purity_id").notNull(),
  ratePerGram: real("rate_per_gram").notNull(),
  effectiveFrom: integer("effective_from").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

function partyColumns() {
  return {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    nic: text("nic").unique(),
    creditLimit: real("credit_limit").notNull().default(0),
    openingBalance: real("opening_balance").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    branchId: text("branch_id").notNull(),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by"),
  };
}

export const suppliers = sqliteTable("suppliers", partyColumns());
export const customers = sqliteTable("customers", partyColumns());
```

Add `real` to the existing `drizzle-orm/sqlite-core` import in schema.ts.

- [ ] **Step 3: Update apps/api/src/seed.ts for fresh installs**

Edit SEED_PERMISSIONS: append `"masters:read", "masters:write",` to the array.
Edit SEED_ROLE_PERMISSIONS:
```ts
  admin: ["users:read", "users:write", "branches:manage", "settings:write", "audit:read", "masters:read", "masters:write"],
  manager: ["users:read", "branches:manage", "audit:read", "masters:read", "masters:write"],
  cashier: ["users:read", "masters:read"],
```

- [ ] **Step 4: Apply migration locally and verify tables**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0002_masters.sql`
Expected: success JSON. Then:
Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('categories','purities','gold_rates','suppliers','customers');"`
Expected: all 5 names listed. Then:
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 5: Commit**

```bash
git add apps/api/drizzle/0002_masters.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: masters tables, migration, seed"
```

---

### Task 3: Catalog services (categories + purities)

**Files:**
- Create: `apps/api/src/services/catalog.ts`
- Test: manual via Task 6 curl (no unit test; service covered by live verification)

**Interfaces:**
- Consumes: `buildAuditStmt` from `../middleware/audit`; `CreateCategoryInput`, `CreatePurityInput` types from `@goldos/shared`.
- Produces: `createCategory, listCategories, deactivateCategory, createPurity, listPurities, deactivatePurity` — signatures below; routes/catalog.ts consumes them in Task 5.

- [ ] **Step 1: Write apps/api/src/services/catalog.ts**

```ts
import type { CreateCategoryInput, CreatePurityInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";

export type CategoryRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: number;
  created_at: number;
};

export type PurityRow = {
  id: string;
  karat: string;
  purity: number;
  default_making_charge: number;
  default_wastage_pct: number;
  is_active: number;
  created_at: number;
};

export type PageOpts = { search?: string; page: number; limit: number };

async function paginate(
  db: D1Database,
  table: "categories" | "purities",
  cols: string,
  match: string,
  opts: PageOpts
): Promise<{ rows: never[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${match}`)
    .bind(like, like)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT ${cols} FROM ${table} WHERE ${match} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(like, like, opts.limit, offset)
    .all();
  return { rows: (results ?? []) as never[], total: count?.total ?? 0 };
}

export async function createCategory(
  db: D1Database,
  input: CreateCategoryInput,
  actorId: string
): Promise<CategoryRow> {
  const dup = await db
    .prepare("SELECT id FROM categories WHERE name = ? OR code = ?")
    .bind(input.name, input.code)
    .first<{ id: string }>();
  if (dup) throw Object.assign(new Error("Category name or code already in use"), { code: "CONFLICT" });
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO categories (id, name, code, description, is_active, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)"
      )
      .bind(id, input.name, input.code, input.description ?? null, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "category.create",
      entity: "category",
      entityId: id,
      next: input,
    }),
  ]);
  return { id, name: input.name, code: input.code, description: input.description ?? null, is_active: 1, created_at: now };
}

export async function listCategories(
  db: D1Database,
  opts: PageOpts
): Promise<{ rows: CategoryRow[]; total: number }> {
  return paginate(
    db,
    "categories",
    "id, name, code, description, is_active, created_at",
    "name LIKE ? OR code LIKE ?",
    opts
  ) as Promise<{ rows: CategoryRow[]; total: number }>;
}

export async function deactivateCategory(
  db: D1Database,
  id: string,
  actorId: string,
  reason: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, is_active FROM categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; is_active: number }>();
  if (!prev) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  await db.batch([
    db.prepare("UPDATE categories SET is_active = 0 WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "category.deactivate",
      entity: "category",
      entityId: id,
      prev: { is_active: prev.is_active },
      next: { is_active: 0 },
      reason,
    }),
  ]);
}

export async function createPurity(
  db: D1Database,
  input: CreatePurityInput,
  actorId: string
): Promise<PurityRow> {
  const dup = await db
    .prepare("SELECT id FROM purities WHERE karat = ?")
    .bind(input.karat)
    .first<{ id: string }>();
  if (dup) throw Object.assign(new Error("Karat already exists"), { code: "CONFLICT" });
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO purities (id, karat, purity, default_making_charge, default_wastage_pct, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
      )
      .bind(id, input.karat, input.purity, input.defaultMakingCharge, input.defaultWastagePct, now),
    buildAuditStmt(db, {
      userId: actorId,
      action: "purity.create",
      entity: "purity",
      entityId: id,
      next: input,
    }),
  ]);
  return {
    id,
    karat: input.karat,
    purity: input.purity,
    default_making_charge: input.defaultMakingCharge,
    default_wastage_pct: input.defaultWastagePct,
    is_active: 1,
    created_at: now,
  };
}

export async function listPurities(db: D1Database, opts: PageOpts): Promise<{ rows: PurityRow[]; total: number }> {
  return paginate(
    db,
    "purities",
    "id, karat, purity, default_making_charge, default_wastage_pct, is_active, created_at",
    "karat LIKE ? OR karat LIKE ?",
    opts
  ) as Promise<{ rows: PurityRow[]; total: number }>;
}

export async function deactivatePurity(
  db: D1Database,
  id: string,
  actorId: string,
  reason: string
): Promise<void> {
  const prev = await db
    .prepare("SELECT id, is_active FROM purities WHERE id = ?")
    .bind(id)
    .first<{ id: string; is_active: number }>();
  if (!prev) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
  await db.batch([
    db.prepare("UPDATE purities SET is_active = 0 WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "purity.deactivate",
      entity: "purity",
      entityId: id,
      prev: { is_active: prev.is_active },
      next: { is_active: 0 },
      reason,
    }),
  ]);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/catalog.ts
git commit -m "feat: catalog services for categories and purities"
```

---

### Task 4: Rates + parties services

**Files:**
- Create: `apps/api/src/services/rates.ts`
- Create: `apps/api/src/services/parties.ts`
- Test: typecheck (live verification in Task 6)

**Interfaces:**
- Consumes: `buildAuditStmt`; `CreateGoldRateInput`, `CreatePartyInput` types; `PageOpts` type from `./catalog`.
- Produces: `createGoldRate, listGoldRates, currentGoldRates`; `createParty, listParties, updateParty` with signature `(db, table: "suppliers" | "customers", ...)`; routes consume them in Task 5.

- [ ] **Step 1: Write apps/api/src/services/rates.ts**

```ts
import type { CreateGoldRateInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";

export type GoldRateRow = {
  id: string;
  purity_id: string;
  karat: string;
  rate_per_gram: number;
  effective_from: number;
  created_at: number;
};

const WITH_KARAT =
  "SELECT g.id, g.purity_id, p.karat, g.rate_per_gram, g.effective_from, g.created_at FROM gold_rates g JOIN purities p ON p.id = g.purity_id";

export async function createGoldRate(
  db: D1Database,
  input: CreateGoldRateInput,
  actorId: string
): Promise<GoldRateRow> {
  const purity = await db
    .prepare("SELECT id, karat, is_active FROM purities WHERE id = ?")
    .bind(input.purityId)
    .first<{ id: string; karat: string; is_active: number }>();
  if (!purity || !purity.is_active)
    throw Object.assign(new Error("Purity not found or inactive"), { code: "NOT_FOUND" });
  const dup = await db
    .prepare("SELECT id FROM gold_rates WHERE purity_id = ? AND effective_from = ?")
    .bind(input.purityId, input.effectiveFrom)
    .first<{ id: string }>();
  if (dup)
    throw Object.assign(new Error("A rate already exists for this purity and effective time"), {
      code: "CONFLICT",
    });
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO gold_rates (id, purity_id, rate_per_gram, effective_from, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(id, input.purityId, input.ratePerGram, input.effectiveFrom, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "gold_rate.create",
      entity: "gold_rate",
      entityId: id,
      next: input,
    }),
  ]);
  return {
    id,
    purity_id: input.purityId,
    karat: purity.karat,
    rate_per_gram: input.ratePerGram,
    effective_from: input.effectiveFrom,
    created_at: now,
  };
}

export async function listGoldRates(
  db: D1Database,
  opts: PageOpts
): Promise<{ rows: GoldRateRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const count = await db
    .prepare(
      "SELECT COUNT(*) AS total FROM gold_rates g JOIN purities p ON p.id = g.purity_id WHERE p.karat LIKE ?"
    )
    .bind(like)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`${WITH_KARAT} WHERE p.karat LIKE ? ORDER BY g.effective_from DESC LIMIT ? OFFSET ?`)
    .bind(like, opts.limit, offset)
    .all<GoldRateRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function currentGoldRates(db: D1Database): Promise<GoldRateRow[]> {
  const { results } = await db
    .prepare(
      `${WITH_KARAT} WHERE g.effective_from <= ? AND g.effective_from = (SELECT MAX(effective_from) FROM gold_rates WHERE purity_id = g.purity_id AND effective_from <= ?) ORDER BY p.karat`
    )
    .bind(Date.now(), Date.now())
    .all<GoldRateRow>();
  return results ?? [];
}
```

- [ ] **Step 2: Write apps/api/src/services/parties.ts**

```ts
import type { CreatePartyInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";

export type PartyTable = "suppliers" | "customers";

export type PartyRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  nic: string | null;
  credit_limit: number;
  opening_balance: number;
  is_active: number;
  branch_id: string;
  created_at: number;
};

const PARTY_COLS =
  "id, name, phone, address, nic, credit_limit, opening_balance, is_active, branch_id, created_at";

export async function createParty(
  db: D1Database,
  table: PartyTable,
  input: CreatePartyInput,
  actorId: string
): Promise<PartyRow> {
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first<{ id: string }>();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  if (input.nic) {
    const dup = await db
      .prepare(`SELECT id FROM ${table} WHERE nic = ?`)
      .bind(input.nic)
      .first<{ id: string }>();
    if (dup) throw Object.assign(new Error("NIC already registered"), { code: "CONFLICT" });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO ${table} (id, name, phone, address, nic, credit_limit, opening_balance, is_active, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .bind(
        id,
        input.name,
        input.phone ?? null,
        input.address ?? null,
        input.nic ?? null,
        input.creditLimit,
        input.openingBalance,
        input.branchId,
        now,
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: `${table}.create`,
      entity: table,
      entityId: id,
      next: input,
      branchId: input.branchId,
    }),
  ]);
  return {
    id,
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    nic: input.nic ?? null,
    credit_limit: input.creditLimit,
    opening_balance: input.openingBalance,
    is_active: 1,
    branch_id: input.branchId,
    created_at: now,
  };
}

export async function listParties(
  db: D1Database,
  table: PartyTable,
  userId: string,
  canManageAll: boolean,
  opts: PageOpts
): Promise<{ rows: PartyRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const scope = canManageAll ? "" : "AND branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)";
  const countBind = canManageAll ? [like, like] : [like, like, userId];
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE (name LIKE ? OR phone LIKE ?) ${scope}`)
    .bind(...countBind)
    .first<{ total: number }>();
  const rowBind = canManageAll ? [like, like, opts.limit, offset] : [like, like, userId, opts.limit, offset];
  const { results } = await db
    .prepare(
      `SELECT ${PARTY_COLS} FROM ${table} WHERE (name LIKE ? OR phone LIKE ?) ${scope} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...rowBind)
    .all<PartyRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function updateParty(
  db: D1Database,
  table: PartyTable,
  id: string,
  patch: { name?: string; phone?: string; address?: string; creditLimit?: number; isActive?: number },
  actorId: string,
  reason?: string
): Promise<void> {
  const prev = await db
    .prepare(`SELECT ${PARTY_COLS} FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<PartyRow>();
  if (!prev) throw Object.assign(new Error("Record not found"), { code: "NOT_FOUND" });
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.phone !== undefined) {
    sets.push("phone = ?");
    vals.push(patch.phone);
  }
  if (patch.address !== undefined) {
    sets.push("address = ?");
    vals.push(patch.address);
  }
  if (patch.creditLimit !== undefined) {
    sets.push("credit_limit = ?");
    vals.push(patch.creditLimit);
  }
  if (patch.isActive !== undefined) {
    sets.push("is_active = ?");
    vals.push(patch.isActive);
  }
  if (sets.length === 0) return;
  await db.batch([
    db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
    buildAuditStmt(db, {
      userId: actorId,
      action: `${table}.update`,
      entity: table,
      entityId: id,
      prev,
      next: patch,
      reason,
      branchId: prev.branch_id,
    }),
  ]);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/rates.ts apps/api/src/services/parties.ts
git commit -m "feat: gold-rate and party services"
```

---

### Task 5: Masters routes + app wiring

**Files:**
- Create: `apps/api/src/routes/catalog.ts`, `apps/api/src/routes/rates.ts`, `apps/api/src/routes/parties.ts`
- Modify: `apps/api/src/app.ts` (mount 3 routers)
- Test: typecheck (live verification in Task 6)

**Interfaces:**
- Consumes: Task 3/4 service functions; `pagination`, `serviceError` from `./http`; `requireAuth`, `requirePerm`; `PERMISSIONS.MASTERS_READ/WRITE`; shared schemas.
- Produces: mounted `GET/POST /categories`, `GET/POST /purities`, `PATCH /purities/:id/deactivate`, `PATCH /categories/:id/deactivate`, `GET/POST /gold-rates`, `GET /gold-rates/current`, `GET/POST/PATCH /suppliers`, `GET/POST/PATCH /customers`.

- [ ] **Step 1: Write apps/api/src/routes/catalog.ts**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { createCategorySchema, createPuritySchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  createCategory,
  createPurity,
  deactivateCategory,
  deactivatePurity,
  listCategories,
  listPurities,
} from "../services/catalog";
import { pagination, serviceError } from "./http";

const deactivateSchema = z.object({ reason: z.string().min(1).max(500) });

export const catalog = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/categories", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid category data" } },
        400
      );
    try {
      const row = await createCategory(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/categories", requirePerm(PERMISSIONS.MASTERS_READ), async (c) => {
    const data = await listCategories(c.env.DB, pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .patch("/categories/:id/deactivate", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deactivateSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await deactivateCategory(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/purities", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createPuritySchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid purity data" } },
        400
      );
    try {
      const row = await createPurity(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/purities", requirePerm(PERMISSIONS.MASTERS_READ), async (c) => {
    const data = await listPurities(c.env.DB, pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .patch("/purities/:id/deactivate", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deactivateSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await deactivatePurity(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
```

- [ ] **Step 2: Write apps/api/src/routes/rates.ts**

```ts
import { Hono } from "hono";
import { createGoldRateSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { createGoldRate, currentGoldRates, listGoldRates } from "../services/rates";
import { pagination, serviceError } from "./http";

export const rates = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createGoldRateSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid rate data" } },
        400
      );
    try {
      const row = await createGoldRate(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/current", requirePerm(PERMISSIONS.MASTERS_READ), async (c) => {
    const data = await currentGoldRates(c.env.DB);
    return c.json({ success: true, data }, 200);
  })
  .get("/", requirePerm(PERMISSIONS.MASTERS_READ), async (c) => {
    const data = await listGoldRates(c.env.DB, pagination(c));
    return c.json({ success: true, data }, 200);
  });
```

- [ ] **Step 3: Write apps/api/src/routes/parties.ts**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { createPartySchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { createParty, listParties, updateParty, type PartyTable } from "../services/parties";
import { pagination, serviceError } from "./http";

const updatePartySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  creditLimit: z.number().min(0).optional(),
  isActive: z.union([z.literal(0), z.literal(1)]).optional(),
  reason: z.string().max(500).optional(),
});

function partyRouter(table: PartyTable) {
  return new Hono<{ Bindings: Env; Variables: AppVariables }>()
    .use(requireAuth)
    .post("/", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = createPartySchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { success: false, error: { code: "VALIDATION", message: "Invalid data" } },
          400
        );
      try {
        const row = await createParty(c.env.DB, table, parsed.data, c.get("userId"));
        return c.json({ success: true, data: row }, 201);
      } catch (err) {
        return serviceError(c, err);
      }
    })
    .get("/", requirePerm(PERMISSIONS.MASTERS_READ), async (c) => {
      const perms = c.get("permissions") as string[];
      const canManageAll = perms.includes(PERMISSIONS.BRANCHES_MANAGE);
      const data = await listParties(c.env.DB, table, c.get("userId"), canManageAll, pagination(c));
      return c.json({ success: true, data }, 200);
    })
    .patch("/:id", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = updatePartySchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { success: false, error: { code: "VALIDATION", message: "Invalid data" } },
          400
        );
      try {
        await updateParty(
          c.env.DB,
          table,
          c.req.param("id"),
          {
            name: parsed.data.name,
            phone: parsed.data.phone,
            address: parsed.data.address,
            creditLimit: parsed.data.creditLimit,
            isActive: parsed.data.isActive,
          },
          c.get("userId"),
          parsed.data.reason
        );
        return c.json({ success: true, data: { ok: true } }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    });
}

export const suppliers = partyRouter("suppliers");
export const customers = partyRouter("customers");
```

- [ ] **Step 4: Mount routers in apps/api/src/app.ts**

Add imports:
```ts
import { catalog } from "./routes/catalog";
import { parties as _unused } from "./routes/parties";
```
No — import correctly:
```ts
import { catalog } from "./routes/catalog";
import { customers, suppliers } from "./routes/parties";
import { rates } from "./routes/rates";
```
Add mounts after settings line:
```ts
app.route("/api/v1/masters", catalog);
app.route("/api/v1/gold-rates", rates);
app.route("/api/v1/suppliers", suppliers);
app.route("/api/v1/customers", customers);
```
Final paths: `POST /api/v1/masters/categories`, `GET /api/v1/masters/purities`, `POST /api/v1/gold-rates`, `GET /api/v1/gold-rates/current`, `POST /api/v1/suppliers`, `PATCH /api/v1/customers/:id`, etc.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/catalog.ts apps/api/src/routes/rates.ts apps/api/src/routes/parties.ts apps/api/src/app.ts
git commit -m "feat: masters, gold-rate, party routes"
```

---

### Task 6: Live API verification

**Files:** none (verification only; local D1 state is git-ignored).

**Interfaces:**
- Consumes: Tasks 1–5. Requires local D1 migrated with 0001 + 0002 and an admin user with masters grants. If the local `.wrangler` state was wiped, re-run: 0001 apply, 0002 apply, then insert roles/permissions (all 7)/grants/admin/branch via `wrangler d1 execute` before starting.

- [ ] **Step 1: Start API and log in**

Run: `nohup pnpm --filter goldos-api exec wrangler dev --local --port 8787 > /tmp/goldos-wrangler.log 2>&1 & sleep 8; curl -s http://localhost:8787/api/v1/health; echo`
Expected: `{"success":true,"data":{"ok":true,"service":"goldos-api"}}`.
Run login, save cookie:
Run: `curl -s -D /tmp/h.txt -o /dev/null http://localhost:8787/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@goldos.lk","password":"<ADMIN_PASSWORD>"}'; grep -i '^set-cookie:' /tmp/h.txt | head -1`
Expected: `Set-Cookie: session=...`. Use that value as `$ADMIN` below. (Password lives only in the local dev DB; never commit it.)

- [ ] **Step 2: Verify catalog**

Run: `curl -s "http://localhost:8787/api/v1/masters/categories" -H "Cookie: $ADMIN" | head -c 200; echo`
Expected: seeded Ring/Chain/etc. rows.
Run: `curl -s http://localhost:8787/api/v1/masters/categories -X POST -H "Cookie: $ADMIN" -H 'Content-Type: application/json' -d '{"name":"Anklet","code":"ANKLET"}'; echo`
Expected: 201 with new row.
Run: `curl -s http://localhost:8787/api/v1/masters/categories -X POST -H "Cookie: $ADMIN" -H 'Content-Type: application/json' -d '{"name":"Anklet","code":"ANKLET2"}'; echo`
Expected: 409 name/code conflict.

- [ ] **Step 3: Verify rates + immutability**

Run: `curl -s http://localhost:8787/api/v1/gold-rates -X POST -H "Cookie: $ADMIN" -H 'Content-Type: application/json' -d '{"purityId":"purity-22k","ratePerGram":28500,"effectiveFrom":1759000000000}'; echo`
Expected: 201 with karat 22K.
Run: `curl -s http://localhost:8787/api/v1/gold-rates/current -H "Cookie: $ADMIN"; echo`
Expected: one row per purity with a rate (22K present).
Run: `curl -s http://localhost:8787/api/v1/gold-rates/xxx -X PATCH -H "Cookie: $ADMIN" -H 'Content-Type: application/json' -d '{}'; echo`
Expected: 404 (no PATCH route — immutability).

- [ ] **Step 4: Verify parties + RBAC**

Run: `curl -s http://localhost:8787/api/v1/suppliers -X POST -H "Cookie: $ADMIN" -H 'Content-Type: application/json' -d '{"name":"Lanka Gold Suppliers","phone":"0771234567","branchId":"<MAIN_BRANCH_ID>"}'; echo`
Expected: 201. (Get MAIN_BRANCH_ID from `/api/v1/branches`.)
Run: create a cashier user (POST /api/v1/users with role cashier), log in as cashier → `$CASHIER`. Then:
Run: `curl -s http://localhost:8787/api/v1/suppliers -X POST -H "Cookie: $CASHIER" -H 'Content-Type: application/json' -d '{"name":"Nope","branchId":"<MAIN_BRANCH_ID>"}'; echo`
Expected: 403 FORBIDDEN.
Run: `curl -s "http://localhost:8787/api/v1/suppliers" -H "Cookie: $CASHIER" | head -c 150; echo`
Expected: 200 list (cashier has masters:read).
Run: `curl -s "http://localhost:8787/api/v1/audit?limit=3" -H "Cookie: $ADMIN" | head -c 300; echo`
Expected: recent `category.create`, `gold_rate.create`, `suppliers.create` actions present.

- [ ] **Step 5: Stop server, run suite**

Run: `pkill -f "wrangler dev"; pnpm exec vitest run 2>&1 | tail -3`
Expected: all tests pass. No commit (no files changed). If any check fails: STOP, fix code in a new commit, re-run.

---

### Task 7: Web masters UI

**Files:**
- Create: `apps/web/components/providers.tsx`, `apps/web/components/master-crud.tsx`
- Modify: `apps/web/app/(app)/layout.tsx` (wrap children in providers), `apps/web/components/app-sidebar.tsx` (5 links)
- Create: `apps/web/app/(app)/categories/page.tsx`, `purities/page.tsx`, `suppliers/page.tsx`, `customers/page.tsx`, `gold-rates/page.tsx`
- Test: `tsc --noEmit` + `next build` + manual click-through against local API

**Interfaces:**
- Consumes: Task 5 endpoints; `api<T>` from `@/lib/api`; `PERMISSIONS.MASTERS_READ` for sidebar gating; `hasPermission` (already used by sidebar).
- Produces: 5 working pages. First `pnpm --filter goldos-web add @tanstack/react-query` (not yet installed — verify with `grep` before adding).

- [ ] **Step 1: Install TanStack Query**

Run: `grep -q '@tanstack/react-query' apps/web/package.json || pnpm --filter goldos-web add @tanstack/react-query`
Expected: dependency present.

- [ ] **Step 2: Write apps/web/components/providers.tsx**

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Toaster richColors />
      {children}
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Write apps/web/components/master-crud.tsx**

Generic table + search + pagination + RHF create dialog + deactivate-with-reason. Server owns validation; client uses required attributes + a Zod schema built from fields.

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";

export type CrudField = {
  name: string;
  label: string;
  type: "text" | "number" | "datetime-local";
  required?: boolean;
};

export type CrudColumn = { key: string; label: string };

type Props = {
  title: string;
  subtitle: string;
  endpoint: string;
  columns: CrudColumn[];
  fields: CrudField[];
  deactivateEndpoint: (id: string) => string;
  emptyHint: string;
};

function schemaFor(fields: CrudField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (f.type === "number") {
      const num = z.coerce.number();
      shape[f.name] = f.required ? num : num.optional();
    } else if (f.type === "datetime-local") {
      shape[f.name] = f.required ? z.string().min(1) : z.string().optional();
    } else {
      const str = z.string().max(500);
      shape[f.name] = f.required ? str.min(1) : str.optional();
    }
  }
  return z.object(shape);
}

export function MasterCrud({ title, subtitle, endpoint, columns, fields, deactivateEndpoint, emptyHint }: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(false);
  const qc = useQueryClient();
  const schema = schemaFor(fields);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Record<string, string | number>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
  });

  const list = useQuery({
    queryKey: [endpoint, search, page],
    queryFn: () =>
      api<{ rows: Record<string, string | number>[]; total: number }>(
        `${endpoint}?search=${encodeURIComponent(search)}&page=${page}&limit=20`
      ),
  });

  const create = useMutation({
    mutationFn: (values: Record<string, string | number>) => {
      const body: Record<string, string | number> = { ...values };
      for (const f of fields) {
        if (f.type === "datetime-local" && typeof body[f.name] === "string") {
          body[f.name] = new Date(body[f.name] as string).getTime();
        }
      }
      return api(endpoint, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(`${title} created`);
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Create failed"),
  });

  const deactivate = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api(deactivateEndpoint(id), { method: "PATCH", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      toast.success("Deactivated");
      qc.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Deactivate failed"),
  });

  function onDeactivate(id: string) {
    const reason = window.prompt("Reason for deactivation (required):");
    if (!reason) return;
    deactivate.mutate({ id, reason });
  }

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-stone-500">{subtitle}</p>
        </div>
        <button
          onClick={() => setDialog(true)}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800"
        >
          New
        </button>
      </div>
      <input
        placeholder="Search…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="w-full max-w-sm rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
      />
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-stone-200" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load. Check the API connection and retry.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          {emptyHint}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-2">{c.label}</th>
                ))}
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="border-b border-stone-100 last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2">{String(r[c.key] ?? "—")}</td>
                  ))}
                  <td className="px-4 py-2">{r.is_active ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-2 text-right">
                    {r.is_active ? (
                      <button
                        onClick={() => onDeactivate(String(r.id))}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <span>{total} total</span>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
        <span>Page {page}</span>
        <button disabled={rows.length < 20} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
      </div>
      {dialog ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
          <form
            onSubmit={handleSubmit((v) => create.mutate(v))}
            className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-lg"
          >
            <h2 className="font-semibold">New {title}</h2>
            {fields.map((f) => (
              <div key={f.name}>
                <label className="mb-1 block text-sm font-medium">{f.label}</label>
                <input
                  type={f.type === "datetime-local" ? "datetime-local" : f.type}
                  step={f.type === "number" ? "any" : undefined}
                  className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-gold"
                  {...register(f.name)}
                />
                {errors[f.name] ? (
                  <p className="mt-1 text-xs text-red-600">Invalid value</p>
                ) : null}
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(false)} className="rounded-md border px-3 py-2 text-sm">Cancel</button>
              <button type="submit" disabled={create.isPending} className="rounded-md bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50">
                {create.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire providers into apps/web/app/\(app\)/layout.tsx**

Read the file first. Wrap the returned content: import `{ Providers }` from `@/components/providers`, replace `<Toaster richColors />` usage if present with `<Providers>…</Providers>` around the layout body (keep Toaster inside Providers only — remove the old standalone Toaster import from the layout to avoid duplicates).

- [ ] **Step 5: Add sidebar links in apps/web/components/app-sidebar.tsx**

Append to LINKS array (before Audit or after — keep Dashboard first, then masters group):
```ts
  { href: "/categories", label: "Categories", perm: "masters:read" },
  { href: "/purities", label: "Purities", perm: "masters:read" },
  { href: "/gold-rates", label: "Gold Rates", perm: "masters:read" },
  { href: "/suppliers", label: "Suppliers", perm: "masters:read" },
  { href: "/customers", label: "Customers", perm: "masters:read" },
```

- [ ] **Step 6: Write the four generic pages**

```tsx
// apps/web/app/(app)/categories/page.tsx
import { MasterCrud } from "@/components/master-crud";

export default function CategoriesPage() {
  return (
    <MasterCrud
      title="Categories"
      subtitle="Product categories for the catalog"
      endpoint="/api/v1/masters/categories"
      columns={[
        { key: "name", label: "Name" },
        { key: "code", label: "Code" },
        { key: "description", label: "Description" },
      ]}
      fields={[
        { name: "name", label: "Name", type: "text", required: true },
        { name: "code", label: "Code", type: "text", required: true },
        { name: "description", label: "Description", type: "text" },
      ]}
      deactivateEndpoint={(id) => `/api/v1/masters/categories/${id}/deactivate`}
      emptyHint="No categories yet. Create the first one."
    />
  );
}
```

```tsx
// apps/web/app/(app)/purities/page.tsx
import { MasterCrud } from "@/components/master-crud";

export default function PuritiesPage() {
  return (
    <MasterCrud
      title="Purities"
      subtitle="Karat definitions with default charges"
      endpoint="/api/v1/masters/purities"
      columns={[
        { key: "karat", label: "Karat" },
        { key: "purity", label: "Purity" },
        { key: "default_making_charge", label: "Making charge" },
        { key: "default_wastage_pct", label: "Wastage %" },
      ]}
      fields={[
        { name: "karat", label: "Karat (e.g. 22K)", type: "text", required: true },
        { name: "purity", label: "Purity decimal (e.g. 0.916)", type: "number", required: true },
        { name: "defaultMakingCharge", label: "Default making charge", type: "number" },
        { name: "defaultWastagePct", label: "Default wastage %", type: "number" },
      ]}
      deactivateEndpoint={(id) => `/api/v1/masters/purities/${id}/deactivate`}
      emptyHint="No purities yet."
    />
  );
}
```

```tsx
// apps/web/app/(app)/suppliers/page.tsx
import { MasterCrud } from "@/components/master-crud";

const PARTY_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "nic", label: "NIC" },
  { key: "credit_limit", label: "Credit limit" },
];

const PARTY_FIELDS = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "phone", label: "Phone", type: "text" },
  { name: "address", label: "Address", type: "text" },
  { name: "nic", label: "NIC", type: "text" },
  { name: "creditLimit", label: "Credit limit (LKR)", type: "number" },
  { name: "openingBalance", label: "Opening balance (LKR)", type: "number" },
  { name: "branchId", label: "Branch ID", type: "text", required: true },
] as const;

export default function SuppliersPage() {
  return (
    <MasterCrud
      title="Suppliers"
      subtitle="Gold and goods suppliers"
      endpoint="/api/v1/suppliers"
      columns={[...PARTY_COLUMNS]}
      fields={[...PARTY_FIELDS]}
      deactivateEndpoint={() => "/api/v1/suppliers/__unused__"}
      emptyHint="No suppliers yet. Create the first one."
    />
  );
}
```

Note: suppliers/customers update via `PATCH /:id` (not `/deactivate`), so `deactivateEndpoint` maps to a PATCH with `{ isActive: 0, reason }`. MasterCrud's deactivate mutation sends `{ reason }` only — extend it: add optional prop `deactivateBody?: (reason: string) => Record<string, unknown>` defaulting to `(reason) => ({ reason })`; suppliers/customers pass `(reason) => ({ isActive: 0, reason })` and `deactivateEndpoint={(id) => `/api/v1/suppliers/${id}`}`. Implement this prop when writing the component (do not use the `__unused__` placeholder above — wire it correctly).

```tsx
// apps/web/app/(app)/customers/page.tsx — same as suppliers with endpoint /api/v1/customers,
// title "Customers", subtitle "Retail and wholesale customers".
```

Branch ID UX: suppliers/customers create requires a branchId. Phase-2 minimum: a text field (branch switcher cookie `goldos_branch` is readable via document.cookie — prefill it as default value in the form). Implement: in `MasterCrud`, add optional prop `defaults?: Record<string, string>`; `useForm({ defaultValues: defaults })`; suppliers/customers pages pass nothing (keep text field) OR read cookie client-side and pass `{ branchId: cookieValue }`. Do the cookie prefill: in page component (client), read `document.cookie` for `goldos_branch` and pass as default. Keep it simple and explicit.

- [ ] **Step 7: Write apps/web/app/\(app\)/gold-rates/page.tsx (custom)**

Current-rates strip + history table + new-rate dialog with purity selector.

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "@/lib/api";

type Rate = { id: string; purity_id: string; karat: string; rate_per_gram: number; effective_from: number };
type Purity = { id: string; karat: string };

const rateSchema = z.object({
  purityId: z.string().min(1),
  ratePerGram: z.coerce.number().gt(0),
  effectiveFrom: z.string().min(1),
});

export default function GoldRatesPage() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const current = useQuery({ queryKey: ["gold-rates-current"], queryFn: () => api<Rate[]>("/api/v1/gold-rates/current") });
  const history = useQuery({
    queryKey: ["gold-rates-history"],
    queryFn: () => api<{ rows: Rate[]; total: number }>("/api/v1/gold-rates?limit=50"),
  });
  const purities = useQuery({
    queryKey: ["purities-all"],
    queryFn: () => api<{ rows: Purity[]; total: number }>("/api/v1/masters/purities?limit=100"),
  });
  const { register, handleSubmit, reset } = useForm<z.infer<typeof rateSchema>>({
    resolver: zodResolver(rateSchema),
  });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof rateSchema>) =>
      api("/api/v1/gold-rates", {
        method: "POST",
        body: JSON.stringify({
          purityId: v.purityId,
          ratePerGram: v.ratePerGram,
          effectiveFrom: new Date(v.effectiveFrom).getTime(),
        }),
      }),
    onSuccess: () => {
      toast.success("Rate published");
      setDialog(false);
      reset();
      qc.invalidateQueries({ queryKey: ["gold-rates-current"] });
      qc.invalidateQueries({ queryKey: ["gold-rates-history"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Publish failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Gold Rates</h1>
          <p className="text-sm text-stone-500">Current buying rates per gram</p>
        </div>
        <button onClick={() => setDialog(true)} className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
          Publish rate
        </bu
...[truncated 2086 chars]