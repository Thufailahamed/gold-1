# GoldOS Product & Barcode Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete product/barcode/inventory foundation — expanded catalog, integer minor units, JW- identifiers, R2 images, product edit, immutable stock ledger with 11 statuses, and full UI with filters — migrated and deployed, camera excluded.

**Architecture:** Three migrations (0005 new masters, 0006 decimal rebuild, 0007 ledger + status map). API contract stays human (grams ≤3dp, LKR ≤2dp); Zod transforms to mg/cents at the boundary; all server math in integers with one final rounding. Movements append-only; product status cached on row, changed only inside movement batches; transition allowlist enforced. Images via existing R2 binding, keys on product row.

**Tech Stack:** Hono, Drizzle, D1, R2, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler, bwip-js.

## Global Constraints

- Every write batches business row(s) + audit_logs; failure rolls back.
- No hard deletes; VOID/cancel with reason; weights immutable after creation (correction = VOID + recreate).
- Strict TypeScript, no `any`; Zod client + server; typed responses.
- Weights INTEGER mg, money INTEGER cents, purity INTEGER permille; convert at API boundary only.
- Barcodes `^(PRD|JW)-[A-Z0-9]{6}$` (PRD- grandfathered, JW- for new); OG-/MELT-/MO-/REP- reserved, no code.
- Locked transitions → 409 TRANSITION_LOCKED; movements + audit in same batch.
- Reuse `masters:*` / `products:*` permissions — no matrix change.
- Images ≤5MB jpeg/png/webp, ≤10 per product, R2 key `products/{id}/{uuid}.{ext}`.

---

## Unit conventions (used verbatim in every task)

- `gToMg(g: number): number` = `Math.round(g * 1000)`; `mgToG(mg)` = `mg / 1000`.
- `lkrToCents(lkr)` = `Math.round(lkr * 100)`; `centsToLkr(c)` = `c / 100`.
- `fineGoldMg(netMg, permille)` = `Math.round((netMg * permille) / 1000)`.
- `priceCents(netMg, rateCentsPerG, makingCents)` = `Math.round((netMg * rateCentsPerG) / 1000) + makingCents`.
- Purity 22K = permille 916. Rate 28500 LKR/g = 2850000 cents/g.
- Live-price check: 5000mg × 2850000 / 1000 = 14,250,000c + making = correct.

## File Structure

- Modify: `packages/shared/src/schemas.ts`, `packages/shared/src/products.test.ts` (regex), `packages/shared/src/masters.test.ts` (untouched)
- Create: `packages/shared/src/units.ts`, `packages/shared/src/units.test.ts`
- Create: `apps/api/drizzle/0005_catalog.sql`, `0006_decimal.sql`, `0007_inventory.sql`
- Modify: `apps/api/src/db/schema.ts` (new masters; rebuilt columns; stock_movements)
- Modify: `apps/api/src/seed.ts` (metal/stone seeds)
- Modify: `apps/api/src/services/catalog.ts` (new entities), `apps/api/src/routes/catalog.ts` (new endpoints)
- Modify: `apps/api/src/services/products.ts` (full rewrite on minor units + edit + JW- + SKU + movements hook), `apps/api/src/services/rates.ts` (cents), `apps/api/src/services/parties.ts` (cents), `apps/api/src/services/label.ts` (unchanged — gram inputs)
- Create: `apps/api/src/services/inventory.ts`, `apps/api/src/routes/inventory.ts`
- Modify: `apps/api/src/routes/products.ts` (edit route, image routes, mg/cents I/O, JW- gen)
- Modify: `apps/web` products list/form/detail, new `scan`, `inventory`, print view; sidebar links
- Modify docs: `database.md`, `api.md`, `barcode-system.md`, new `inventory.md` (deferred? No — write `docs/inventory.md`)

---

### Task 1: Shared units + barcode regex + catalog schemas

**Files:**
- Create: `packages/shared/src/units.ts`, `packages/shared/src/units.test.ts`
- Modify: `packages/shared/src/schemas.ts` (BARCODE_RE, append catalog + product edit schemas)
- Modify: `packages/shared/src/products.test.ts` (regex both prefixes)
- Test: units + products + masters tests

**Interfaces:**
- Consumes: existing `z`.
- Produces: `gToMg, mgToG, lkrToCents, centsToLkr, fineGoldMg, priceCents`; `BARCODE_RE = /^(PRD|JW)-[A-Z0-9]{6}$/`; `createSubcategorySchema, createDesignSchema, createProductTypeSchema, createMetalTypeSchema, createStoneTypeSchema, editProductSchema`; updated `createProductSchema` (grams in, transformed).

- [ ] **Step 1: Write failing units test**

```ts
// packages/shared/src/units.test.ts
import { describe, expect, it } from "vitest";
import { centsToLkr, fineGoldMg, gToMg, lkrToCents, mgToG, priceCents } from "./units";

describe("units", () => {
  it("converts grams to mg", () => {
    expect(gToMg(5.2)).toBe(5200);
    expect(mgToG(5200)).toBe(5.2);
  });
  it("converts LKR to cents", () => {
    expect(lkrToCents(15000)).toBe(1500000);
    expect(centsToLkr(1500000)).toBe(15000);
  });
  it("computes fine gold", () => {
    expect(fineGoldMg(5000, 916)).toBe(4580);
  });
  it("prices 5g at 28500 + 15000 making", () => {
    expect(priceCents(5000, 2850000, 1500000)).toBe(15750000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/units.test.ts`
Expected: FAIL (missing module).

- [ ] **Step 3: Write units.ts**

```ts
export function gToMg(g: number): number {
  return Math.round(g * 1000);
}
export function mgToG(mg: number): number {
  return mg / 1000;
}
export function lkrToCents(lkr: number): number {
  return Math.round(lkr * 100);
}
export function centsToLkr(cents: number): number {
  return cents / 100;
}
export function fineGoldMg(netMg: number, permille: number): number {
  return Math.round((netMg * permille) / 1000);
}
export function priceCents(netMg: number, rateCentsPerG: number, makingCents: number): number {
  return Math.round((netMg * rateCentsPerG) / 1000) + makingCents;
}
```

- [ ] **Step 4: Update schemas.ts**

Replace: `export const BARCODE_RE = /^PRD-[A-Z0-9]{6}$/;` with
`export const BARCODE_RE = /^(PRD|JW)-[A-Z0-9]{6}$/;`

Append (after product schema):
```ts
const refId = z.string().min(1);
const optRef = refId.optional();

export const createSubcategorySchema = z.object({
  categoryId: refId,
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
});
export const createDesignSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
});
export const createProductTypeSchema = createDesignSchema;
export const createMetalTypeSchema = createDesignSchema;
export const createStoneTypeSchema = createDesignSchema;

export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: refId,
  subcategoryId: optRef,
  designId: optRef,
  productTypeId: optRef,
  metalTypeId: refId,
  stoneTypeId: optRef,
  purityId: refId,
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  wastageG: z.number().min(0).optional().default(0),
  costLkr: z.number().min(0).optional(),
  sellingPriceLkr: z.number().min(0).optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  branchId: z.string().min(1),
});

export const editProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subcategoryId: optRef,
  designId: optRef,
  productTypeId: optRef,
  metalTypeId: optRef,
  stoneTypeId: optRef,
  makingLkr: z.number().min(0).optional(),
  wastageG: z.number().min(0).optional(),
  costLkr: z.number().min(0).optional(),
  sellingPriceLkr: z.number().min(0).optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type EditProductInput = z.infer<typeof editProductSchema>;
```

Note: this REPLACES the old grams-based createProductSchema (grossWeight etc.) — old field names removed. Existing `products.test.ts` valid object uses old names → update it in Step 5. Old `CreateProductInput` type name reused with new shape — services rewritten in Task 5.

- [ ] **Step 5: Update products.test.ts valid object + regex test**

Change valid to `{ name: "22K Wedding Ring", categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", grossG: 5.2, stoneG: 0.2, makingLkr: 15000, branchId: "branch-main" }`; assertions `.grossG`. Regex tests: add `expect(BARCODE_RE.test("JW-A3F9K2")).toBe(true)` and keep PRD ones; keep lowercase/OLD- rejections.

- [ ] **Step 6: Run all shared tests + typecheck**

Run: `pnpm exec vitest run packages/shared 2>&1 | grep -E "Tests |Files"; pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
Expected: all pass (API tsc will fail until services rewritten — expected).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/units.ts packages/shared/src/units.test.ts packages/shared/src/schemas.ts packages/shared/src/products.test.ts
git commit -m "feat: minor-unit helpers, JW barcodes, catalog schemas"
```

---

### Task 2: Migrations 0005 catalog + 0006 decimal

**Files:**
- Create: `apps/api/drizzle/0005_catalog.sql`, `apps/api/drizzle/0006_decimal.sql`
- Modify: `apps/api/src/db/schema.ts` (new masters; rebuilt columns)
- Modify: `apps/api/src/seed.ts` (metal/stone seeds)
- Test: local apply + verify seeds + converted values

**Interfaces:**
- Consumes: Task 1 (nothing directly; column names).
- Produces: 5 new master tables; mg/cents/permille columns everywhere; seeds.

- [ ] **Step 1: Write 0005_catalog.sql**

```sql
CREATE TABLE subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE designs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE product_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE metal_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE stone_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO metal_types (id, name, code, created_at) VALUES
  ('metal-gold', 'Gold', 'GOLD', 1759000000000),
  ('metal-silver', 'Silver', 'SILVER', 1759000000000),
  ('metal-platinum', 'Platinum', 'PLATINUM', 1759000000000);
INSERT INTO stone_types (id, name, code, created_at) VALUES
  ('stone-none', 'None', 'NONE', 1759000000000),
  ('stone-diamond', 'Diamond', 'DIAMOND', 1759000000000),
  ('stone-ruby', 'Ruby', 'RUBY', 1759000000000),
  ('stone-sapphire', 'Sapphire', 'SAPPHIRE', 1759000000000),
  ('stone-emerald', 'Emerald', 'EMERALD', 1759000000000),
  ('stone-pearl', 'Pearl', 'PEARL', 1759000000000);
```

- [ ] **Step 2: Write 0006_decimal.sql (table rebuilds)**

Purities first (products references purities — rebuild order: purities, then products; gold_rates references purities but keeps purity_id TEXT — no FK issue during rebuild since we copy same ids):

```sql
CREATE TABLE purities_new (
  id TEXT PRIMARY KEY,
  karat TEXT NOT NULL UNIQUE,
  permille INTEGER NOT NULL,
  default_making_cents INTEGER NOT NULL DEFAULT 0,
  default_wastage_mg INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
INSERT INTO purities_new (id, karat, permille, default_making_cents, default_wastage_mg, is_active, created_at)
  SELECT id, karat, CAST(ROUND(purity * 1000) AS INTEGER), CAST(ROUND(default_making_charge * 100) AS INTEGER), CAST(ROUND(default_wastage_pct * 1000) AS INTEGER), is_active, created_at FROM purities;
DROP TABLE purities;
ALTER TABLE purities_new RENAME TO purities;

CREATE TABLE gold_rates_new (
  id TEXT PRIMARY KEY,
  purity_id TEXT NOT NULL REFERENCES purities(id),
  rate_cents_per_g INTEGER NOT NULL,
  effective_from INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  UNIQUE (purity_id, effective_from)
);
INSERT INTO gold_rates_new (id, purity_id, rate_per_gram_placeholder, effective_from, created_at, created_by)
```

No — column lists must match. Write correctly:
```sql
INSERT INTO gold_rates_new (id, purity_id, rate_cents_per_g, effective_from, created_at, created_by)
  SELECT id, purity_id, CAST(ROUND(rate_per_gram * 100) AS INTEGER), effective_from, created_at, created_by FROM gold_rates;
DROP TABLE gold_rates;
ALTER TABLE gold_rates_new RENAME TO gold_rates;
CREATE INDEX idx_gold_rates_current ON gold_rates(purity_id, effective_from DESC);
```

Parties (suppliers + customers share shape — repeat block twice):
```sql
CREATE TABLE suppliers_new (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT,
  nic TEXT UNIQUE, credit_limit_cents INTEGER NOT NULL DEFAULT 0,
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL, created_by TEXT REFERENCES users(id)
);
INSERT INTO suppliers_new (id, name, phone, address, nic, credit_limit_cents, opening_balance_cents, is_active, branch_id, created_at, created_by)
  SELECT id, name, phone, address, nic, CAST(ROUND(credit_limit * 100) AS INTEGER), CAST(ROUND(opening_balance * 100) AS INTEGER), is_active, branch_id, created_at, created_by FROM suppliers;
DROP TABLE suppliers;
ALTER TABLE suppliers_new RENAME TO suppliers;
```
(Repeat identical block for customers.)

Products rebuild WITH all new columns (0005 did not touch products):
```sql
CREATE TABLE products_new (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL UNIQUE,
  sku TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  subcategory_id TEXT REFERENCES subcategories(id),
  design_id TEXT REFERENCES designs(id),
  product_type_id TEXT REFERENCES product_types(id),
  metal_type_id TEXT NOT NULL REFERENCES metal_types(id),
  stone_type_id TEXT REFERENCES stone_types(id),
  purity_id TEXT NOT NULL REFERENCES purities(id),
  name TEXT NOT NULL,
  gross_mg INTEGER NOT NULL,
  stone_mg INTEGER NOT NULL DEFAULT 0,
  net_mg INTEGER NOT NULL,
  fine_gold_mg INTEGER NOT NULL DEFAULT 0,
  making_cents INTEGER NOT NULL DEFAULT 0,
  wastage_mg INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER,
  selling_price_cents INTEGER,
  location TEXT,
  notes TEXT,
  image_keys TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'IN_STOCK',
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO products_new (id, barcode, sku, category_id, purity_id, name, gross_mg, stone_mg, net_mg, fine_gold_mg, making_cents, status, branch_id, created_at, created_by)
  SELECT id, barcode, 'SKU-' || SUBSTR(UPPER(HEX(RANDOMBLOB(3))), 1, 6), category_id, purity_id, name,
    CAST(ROUND(gross_weight * 1000) AS INTEGER), CAST(ROUND(stone_weight * 1000) AS INTEGER),
    CAST(ROUND(net_weight * 1000) AS INTEGER),
    CAST(ROUND(net_weight * 1000 * purity * 1000) / 1000 AS INTEGER),
```

No — fine gold needs permille from NEW purities table. SQLite can't easily join in this dialect... it can: subquery `(SELECT permille FROM purities WHERE purities.id = products.purity_id)`. Write:
```sql
    CAST(ROUND(CAST(ROUND(net_weight * 1000) AS INTEGER) * (SELECT permille FROM purities WHERE purities.id = products.purity_id) / 1000.0) AS INTEGER),
    CAST(ROUND(making_charge * 100) AS INTEGER), status, branch_id, created_at, created_by FROM products;
DROP TABLE products;
ALTER TABLE products_new RENAME TO products;
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_branch_status ON products(branch_id, status);
CREATE UNIQUE INDEX idx_products_sku ON products(sku);
```

Wait — status mapping old→new happens in 0007, but 0006 rebuild copies `status` TEXT as-is (in_stock/sold/void survive; CHECK not added yet). 0007 does the mapping. Correct per plan (0007 = status map). But new-column defaults: metal_type_id NOT NULL — copy must supply it: add `'metal-gold'` literal in SELECT (metal_types seeded in 0005 — 0006 runs after 0005, FK satisfied). Add `metal_type_id` to column list + `'metal-gold'` in SELECT. Also default_wastage interpretation change: old default_wastage_pct (%) → default_wastage_mg is WRONG conversion (pct×1000 ≠ mg). Purities' wastage: old semantics percent, new semantics absolute mg default. Honest approach: set default_wastage_mg = 0 for converted rows (percent defaults don't translate), note in commit/docs. Change SELECT to `0` for that column. Making charge LKR→cents is exact. Purity decimal→permille exact for 3dp values.

- [ ] **Step 3: Update Drizzle schema + seed**

Drizzle: add 5 master tables (same shape as categories: id/name/code/isActive/createdAt/createdBy; subcategories adds categoryId). Rewrite purities (permille, defaultMakingCents, defaultWastageMg), goldRates (rateCentsPerG), partyColumns (creditLimitCents, openingBalanceCents), products (full new column set). seed.ts: add metal/stone seeds (mirror SQL; also add to buildSeedSql? buildSeedSql is for fresh installs — migrations cover existing DBs; fresh installs run all migrations anyway, so seed.ts only needs SEED additions if buildSeedSql inserts masters — it doesn't currently. Check: buildSeedSql inserts roles/perms/users/branches only. So NO seed.ts change needed except nothing. Remove seed.ts from this task: instead verify fresh-install path = run 0001..0007 in order (0005/0006 carry seeds). Drop seed.ts modification.)

- [ ] **Step 4: Apply local, verify conversions**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0005_catalog.sql` → success.
Run: `... --file ./drizzle/0006_decimal.sql` → success.
Run check: `SELECT karat, permille FROM purities; SELECT COUNT(*) AS m FROM metal_types; SELECT barcode, gross_mg, net_mg, fine_gold_mg, sku, metal_type_id, status FROM products;`
Expected: 22K→916; metals 3; existing test products converted (e.g. 5.2g→5200mg), sku LIKE 'SKU-%', metal-gold, old statuses preserved.
Run: `pnpm --filter goldos-api exec tsc --noEmit` (expect errors in products/rates/parties/label services — rewritten Tasks 4–5).

- [ ] **Step 5: Commit**

```bash
git add apps/api/drizzle/0005_catalog.sql apps/api/drizzle/0006_decimal.sql apps/api/src/db/schema.ts
git commit -m "feat: catalog masters and minor-unit decimal migration"
```

---

### Task 3: Migration 0007 inventory ledger

**Files:**
- Create: `apps/api/drizzle/0007_inventory.sql`
- Modify: `apps/api/src/db/schema.ts` (stock_movements)
- Test: local apply + movement insert smoke

**Interfaces:**
- Consumes: products table from Task 2.
- Produces: `stock_movements` table; statuses mapped; `ALLOWLIST` consumed from Task 4 code (defined in inventory service, not SQL).

- [ ] **Step 1: Write 0007_inventory.sql**

```sql
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_branch TEXT REFERENCES branches(id),
  to_branch TEXT REFERENCES branches(id),
  weight_mg INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX idx_movements_branch ON stock_movements(to_branch, created_at DESC);
UPDATE products SET status = CASE status
  WHEN 'in_stock' THEN 'IN_STOCK'
  WHEN 'sold' THEN 'SOLD'
  WHEN 'void' THEN 'VOID'
  ELSE 'IN_STOCK' END;
```

Movement types: INTAKE, TRANSFER_OUT, TRANSFER_IN, RETURN, LOSS, VOID. (ADJUST deferred — corrections via VOID+recreate.)

- [ ] **Step 2: Drizzle append**

```ts
export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  type: text("type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  fromBranch: text("from_branch"),
  toBranch: text("to_branch"),
  weightMg: text("weight_mg").notNull(),  // INTEGER affinity via text()? No —
});
```

No: weightMg must be integer: `weightMg: integer("weight_mg").notNull()`.

- [ ] **Step 3: Apply + smoke**

Run apply; Run: `SELECT COUNT(*) AS m FROM stock_movements; SELECT DISTINCT status FROM products;`
Expected: 0 movements; statuses uppercase mapped.

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0007_inventory.sql apps/api/src/db/schema.ts
git commit -m "feat: stock movements ledger and status mapping"
```

---

### Task 4: Inventory service + routes

**Files:**
- Create: `apps/api/src/services/inventory.ts`
- Create: `apps/api/src/routes/inventory.ts`
- Modify: `apps/api/src/app.ts` (mount `/api/v1/inventory`)
- Test: typecheck (live in Task 7)

**Interfaces:**
- Consumes: `buildAuditStmt`; `PageOpts` from `./catalog`.
- Produces: `recordMovement, transferProduct, stockSummary`; routes `POST /inventory/movements`, `GET /inventory/movements`, `GET /inventory/stock?groupBy=`.

Transition allowlist (verbatim):
```ts
const ALLOW: Record<string, string[]> = {
  IN_STOCK: ["TRANSFER_PENDING", "RETURNED", "LOST", "VOID"],
  TRANSFER_PENDING: ["IN_STOCK"],
  RETURNED: ["IN_STOCK", "VOID"],
  LOST: [],
  VOID: [],
  RESERVED: [], SOLD: [], IN_REPAIR: [], IN_MANUFACTURING: [],
  MELTING: [], MELTED: [],
};
```
Any to_status not in ALLOW[from] (or any locked target like SOLD/MELTING) → `{ code: "TRANSITION_LOCKED", message: "Transition not available in this phase" }` → serviceError needs a 409 branch: add `if (code === "TRANSITION_LOCKED") return 409` to http.ts (modify in this task).

- [ ] **Step 1: Write services/inventory.ts**

```ts
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";

export type MovementType = "INTAKE" | "TRANSFER_OUT" | "TRANSFER_IN" | "RETURN" | "LOSS" | "VOID";

const ALLOW: Record<string, string[]> = { ... (as above) ... };

function checkTransition(from: string, to: string): void {
  if (!(ALLOW[from] ?? []).includes(to))
    throw Object.assign(new Error(`Transition ${from} → ${to} not available in this phase`), {
      code: "TRANSITION_LOCKED",
    });
}

export type MoveInput = { productId: string; toStatus: string; toBranchId?: string; reason?: string };

export async function recordMovement(
  db: D1Database,
  input: MoveInput,
  actorId: string
): Promise<{ movementId: string }> {
  const prev = await db
    .prepare("SELECT id, status, branch_id, net_mg FROM products WHERE id = ?")
    .bind(input.productId)
    .first<{ id: string; status: string; branch_id: string; net_mg: number }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  checkTransition(prev.status, input.toStatus);
  if (["VOID", "LOST"].includes(input.toStatus) && !input.reason)
    throw Object.assign(new Error("Reason required"), { code: "VALIDATION" });

  const type: MovementType =
    input.toStatus === "VOID" ? "VOID" : input.toStatus === "LOST" ? "LOSS"
    : input.toStatus === "RETURNED" ? "RETURN"
    : input.toStatus === "TRANSFER_PENDING" ? "TRANSFER_OUT" : "TRANSFER_IN";
  // TRANSFER_PENDING completes immediately with toBranchId in this phase:
  // write TRANSFER_OUT then TRANSFER_IN in one batch when toBranchId present.
  ...
}
```

Transfer semantics (keep one call): if toStatus TRANSFER_PENDING requires toBranchId (validated active); batch: [UPDATE status TRANSFER_PENDING, INSERT TRANSFER_OUT movement, UPDATE branch+status IN_STOCK, INSERT TRANSFER_IN movement, audit]. Else single: [UPDATE status, INSERT movement, audit]. VOID/LOST require reason.

Full code (write completely):
```ts
export async function recordMovement(db: D1Database, input: MoveInput, actorId: string): Promise<{ movementId: string }> {
  const prev = await db.prepare("SELECT id, status, branch_id, net_mg FROM products WHERE id = ?").bind(input.productId).first<{ id: string; status: string; branch_id: string; net_mg: number }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  checkTransition(prev.status, input.toStatus);
  if ((input.toStatus === "VOID" || input.toStatus === "LOST") && !input.reason)
    throw Object.assign(new Error("Reason required for VOID/LOST"), { code: "VALIDATION" });
  const now = Date.now();
  const mid = crypto.randomUUID();
  const mkMove = (type: MovementType, fromS: string, toS: string, fromB: string | null, toB: string | null) =>
    db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), input.productId, type, fromS, toS, fromB, toB, prev.net_mg, input.reason ?? null, now, actorId);

  if (input.toStatus === "TRANSFER_PENDING") {
    if (!input.toBranchId) throw Object.assign(new Error("toBranchId required for transfer"), { code: "VALIDATION" });
    const br = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.toBranchId).first();
    if (!br) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
    await db.batch([
      db.prepare("UPDATE products SET status = 'TRANSFER_PENDING' WHERE id = ?").bind(input.productId),
      mkMove("TRANSFER_OUT", prev.status, "TRANSFER_PENDING", prev.branch_id, input.toBranchId),
      db.prepare("UPDATE products SET status = 'IN_STOCK', branch_id = ? WHERE id = ?").bind(input.toBranchId, input.productId),
      mkMove("TRANSFER_IN", "TRANSFER_PENDING", "IN_STOCK", prev.branch_id, input.toBranchId),
      buildAuditStmt(db, { userId: actorId, action: "inventory.transfer", entity: "product", entityId: input.productId, prev: { status: prev.status, branch: prev.branch_id }, next: { status: "IN_STOCK", branch: input.toBranchId }, reason: input.reason, branchId: input.toBranchId }),
    ]);
    return { movementId: mid };
  }
  const type: MovementType = input.toStatus === "VOID" ? "VOID" : input.toStatus === "LOST" ? "LOSS" : input.toStatus === "RETURNED" ? "RETURN" : "TRANSFER_IN";
  await db.batch([
    db.prepare("UPDATE products SET status = ? WHERE id = ?").bind(input.toStatus, input.productId),
    mkMove(type, prev.status, inpu
...[truncated 20862 chars]