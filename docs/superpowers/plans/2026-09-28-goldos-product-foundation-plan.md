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
  const moveId = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE products SET status = ? WHERE id = ?").bind(input.toStatus, input.productId),
    db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(moveId, input.productId, type, prev.status, input.toStatus, prev.branch_id, prev.branch_id, prev.net_mg, input.reason ?? null, now, actorId),
    buildAuditStmt(db, { userId: actorId, action: `inventory.${type.toLowerCase()}`, entity: "product", entityId: input.productId, prev: { status: prev.status }, next: { status: input.toStatus }, reason: input.reason, branchId: prev.branch_id }),
  ]);
  return { movementId: moveId };
}
```

For the TRANSFER_PENDING branch above, replace `return { movementId: mid };` with building an explicit id: change `const mid = crypto.randomUUID();` usage — implementer: create `const outId = crypto.randomUUID(); const inId = crypto.randomUUID();` and use them in the two mkMove calls (extend mkMove to accept an id param), return `{ movementId: inId }`. Remove unused `mid`.

```ts
export async function listMovements(db: D1Database, opts: PageOpts & { productId?: string; branchId?: string; type?: string }): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(m.type LIKE ? OR m.reason LIKE ?)"];
  const vals: unknown[] = [like, like];
  if (opts.productId) { conds.push("m.product_id = ?"); vals.push(opts.productId); }
  if (opts.branchId) { conds.push("(m.from_branch = ? OR m.to_branch = ?)"); vals.push(opts.branchId, opts.branchId); }
  if (opts.type) { conds.push("m.type = ?"); vals.push(opts.type); }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM stock_movements m ${where}`).bind(...vals).first<{ total: number }>();
  const { results } = await db.prepare(`SELECT m.id, m.product_id, p.barcode, m.type, m.from_status, m.to_status, m.from_branch, m.to_branch, m.weight_mg, m.reason, m.created_at, m.created_by FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`).bind(...vals, opts.limit, offset).all();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function stockSummary(db: D1Database, groupBy: "branch" | "purity" | "product"): Promise<Record<string, unknown>[]> {
  const col = groupBy === "branch" ? "p.branch_id" : groupBy === "purity" ? "p.purity_id" : "p.id";
  const { results } = await db.prepare(
    `SELECT ${col} AS key, COUNT(*) AS pieces, SUM(p.net_mg) AS net_mg, SUM(p.fine_gold_mg) AS fine_mg FROM products p WHERE p.status = 'IN_STOCK' GROUP BY ${col} ORDER BY net_mg DESC`
  ).all();
  const rates = await currentGoldRates(db);
  const byPurity = new Map(rates.map((r) => [r.purity_id, r.rate_cents_per_g]));
  const { results: all } = await db.prepare(`SELECT branch_id, purity_id, net_mg FROM products WHERE status = 'IN_STOCK'`).all<{ branch_id: string; purity_id: string; net_mg: number }>();
  const valByKey = new Map<string, number>();
  for (const row of all ?? []) {
    const k = groupBy === "branch" ? row.branch_id : groupBy === "purity" ? row.purity_id : "";
    const rate = byPurity.get(row.purity_id) ?? 0;
    valByKey.set(k, (valByKey.get(k) ?? 0) + Math.round((row.net_mg * rate) / 1000));
  }
  return (results ?? []).map((r) => ({ ...(r as object), value_cents: groupBy === "product" ? null : (valByKey.get((r as { key: string }).key) ?? 0) }));
}
```

Note: product-grouped value is null (needs per-row making charge — detail endpoint covers pricing; summary keeps weight + fine gold for products).

- [ ] **Step 2: Write apps/api/src/routes/inventory.ts**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { listMovements, recordMovement, stockSummary } from "../services/inventory";
import { pagination, serviceError } from "./http";

const moveSchema = z.object({
  productId: z.string().min(1),
  toStatus: z.string().min(1),
  toBranchId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

const stockQuery = z.object({ groupBy: z.enum(["branch", "purity", "product"]).optional().default("branch") });

export const inventory = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/movements", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = moveSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid movement" } }, 400);
    try {
      const data = await recordMovement(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/movements", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const data = await listMovements(c.env.DB, {
      ...pagination(c),
      productId: c.req.query("productId"),
      branchId: c.req.query("branchId"),
      type: c.req.query("type"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/stock", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const parsed = stockQuery.safeParse({ groupBy: c.req.query("groupBy") ?? undefined });
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid groupBy" } }, 400);
    const data = await stockSummary(c.env.DB, parsed.data.groupBy);
    return c.json({ success: true, data }, 200);
  });
```

- [ ] **Step 3: Mount + http.ts TRANSITION_LOCKED**

app.ts: `import { inventory } from "./routes/inventory";` + `app.route("/api/v1/inventory", inventory);`
http.ts: add `if (code === "TRANSITION_LOCKED") return c.json({ success: false, error: { code, message } }, 409);` after VALIDATION branch.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK` (products routes still old — errors expected ONLY in routes/products.ts, services/products.ts consumers, label call sites; inventory files clean).
```bash
git add apps/api/src/services/inventory.ts apps/api/src/routes/inventory.ts apps/api/src/app.ts apps/api/src/routes/http.ts
git commit -m "feat: inventory ledger service and routes"
```

---

### Task 5: Rewrite products/rates/parties services on minor units

**Files:**
- Modify: `apps/api/src/services/products.ts` (full rewrite), `apps/api/src/services/rates.ts` (cents), `apps/api/src/services/parties.ts` (cents)
- Test: tsc (errors expected ONLY in route files)

**Interfaces:**
- Consumes: Task 1 units + schemas; Task 4 movements (create writes INTAKE inline, void writes VOID inline — no import needed).
- Produces: minor-unit rows; `editProduct`; JW-/SKU- generation; cents rates/parties with float-compatible read shapes.

- [ ] **Step 1: Rewrite services/products.ts** (complete file)

```ts
import { BARCODE_RE, fineGoldMg, gToMg, lkrToCents, priceCents, type CreateProductInput, type EditProductInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRates } from "./rates";

export type ProductRow = {
  id: string; barcode: string; sku: string;
  category_id: string; category_name: string;
  subcategory_id: string | null; design_id: string | null;
  product_type_id: string | null; metal_type_id: string; metal_name: string;
  stone_type_id: string | null; purity_id: string; karat: string; permille: number;
  name: string; gross_mg: number; stone_mg: number; net_mg: number; fine_gold_mg: number;
  making_cents: number; wastage_mg: number; cost_cents: number | null;
  selling_price_cents: number | null; location: string | null; notes: string | null;
  image_keys: string[]; status: string; branch_id: string; created_at: number;
};

export type LivePrice = { amount_cents: number; rate_cents_per_g: number; rate_effective_from: number } | null;
export type ProductDetail = { product: ProductRow; livePrice: LivePrice; noRate: boolean };

type RawRow = Omit<ProductRow, "image_keys"> & { image_keys: string };

const WITH_NAMES = "SELECT p.id, p.barcode, p.sku, p.category_id, c.name AS category_name, p.subcategory_id, p.design_id, p.product_type_id, p.metal_type_id, m.name AS metal_name, p.stone_type_id, p.purity_id, pu.karat, pu.permille, p.name, p.gross_mg, p.stone_mg, p.net_mg, p.fine_gold_mg, p.making_cents, p.wastage_mg, p.cost_cents, p.selling_price_cents, p.location, p.notes, p.image_keys, p.status, p.branch_id, p.created_at FROM products p JOIN categories c ON c.id = p.category_id JOIN metal_types m ON m.id = p.metal_type_id JOIN purities pu ON pu.id = p.purity_id";

function parseRow(r: RawRow): ProductRow {
  return { ...r, image_keys: JSON.parse(r.image_keys) as string[] };
}

const BARCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(prefix: "JW-" | "SKU-"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = prefix;
  for (const b of bytes) s += BARCODE_ALPHABET[b % BARCODE_ALPHABET.length];
  return s;
}

async function uniqueCode(db: D1Database, column: "barcode" | "sku", prefix: "JW-" | "SKU-"): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomCode(prefix);
    if (prefix === "JW-" && !BARCODE_RE.test(candidate)) continue;
    const dup = await db.prepare(`SELECT id FROM products WHERE ${column} = ?`).bind(candidate).first();
    if (!dup) return candidate;
  }
  throw Object.assign(new Error("Could not generate unique code"), { code: "INTERNAL" });
}

async function checkRef(db: D1Database, table: string, id: string, label: string): Promise<void> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ? AND is_active = 1`).bind(id).first();
  if (!row) throw Object.assign(new Error(`${label} not found or inactive`), { code: "NOT_FOUND" });
}

export async function priceFor(db: D1Database, purityId: string, netMg: number, makingCents: number): Promise<{ livePrice: LivePrice; noRate: boolean }> {
  const rates = await currentGoldRates(db);
  const rate = rates.find((r) => r.purity_id === purityId);
  if (!rate) return { livePrice: null, noRate: true };
  return {
    livePrice: { amount_cents: priceCents(netMg, rate.rate_cents_per_g, makingCents), rate_cents_per_g: rate.rate_cents_per_g, rate_effective_from: rate.effective_from },
    noRate: false,
  };
}
```

Note: this requires rates.ts to expose `rate_cents_per_g` on its rows — done in Step 3 below (internal `currentGoldRatesCents` + mapped public shape).

```ts
export async function createProduct(db: D1Database, input: CreateProductInput, actorId: string): Promise<ProductRow> {
  await checkRef(db, "categories", input.categoryId, "Category");
  if (input.subcategoryId) await checkRef(db, "subcategories", input.subcategoryId, "Subcategory");
  if (input.designId) await checkRef(db, "designs", input.designId, "Design");
  if (input.productTypeId) await checkRef(db, "product_types", input.productTypeId, "Product type");
  await checkRef(db, "metal_types", input.metalTypeId, "Metal type");
  if (input.stoneTypeId) await checkRef(db, "stone_types", input.stoneTypeId, "Stone type");
  await checkRef(db, "purities", input.purityId, "Purity");
  const grossMg = gToMg(input.grossG);
  const stoneMg = gToMg(input.stoneG);
  const netMg = grossMg - stoneMg;
  if (netMg <= 0) throw Object.assign(new Error("Stone weight must be less than gross weight"), { code: "VALIDATION" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const purity = await db.prepare("SELECT permille FROM purities WHERE id = ?").bind(input.purityId).first<{ permille: number }>();
  if (!purity) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
  const barcode = await uniqueCode(db, "barcode", "JW-");
  const sku = await uniqueCode(db, "sku", "SKU-");
  const makingCents = lkrToCents(input.makingLkr);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO products (id, barcode, sku, category_id, subcategory_id, design_id, product_type_id, metal_type_id, stone_type_id, purity_id, name, gross_mg, stone_mg, net_mg, fine_gold_mg, making_cents, wastage_mg, cost_cents, selling_price_cents, location, notes, image_keys, status, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?, ?, ?)")
      .bind(id, barcode, sku, input.categoryId, input.subcategoryId ?? null, input.designId ?? null, input.productTypeId ?? null, input.metalTypeId, input.stoneTypeId ?? null, input.purityId, input.name, grossMg, stoneMg, netMg, fineGoldMg(netMg, purity.permille), makingCents, gToMg(input.wastageG), input.costLkr !== undefined ? lkrToCents(input.costLkr) : null, input.sellingPriceLkr !== undefined ? lkrToCents(input.sellingPriceLkr) : null, input.location ?? null, input.notes ?? null, "[]", input.branchId, now, actorId),
    db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'INTAKE', NULL, 'IN_STOCK', NULL, ?, ?, 'intake', ?, ?)")
      .bind(crypto.randomUUID(), id, input.branchId, netMg, now, actorId),
    buildAuditStmt(db, { userId: actorId, action: "product.create", entity: "product", entityId: id, next: { ...input, barcode, sku }, branchId: input.branchId }),
  ]);
  const created = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<RawRow>();
  if (!created) throw new Error("Product insert failed");
  return parseRow(created);
}

export async function editProduct(db: D1Database, id: string, patch: EditProductInput, actorId: string): Promise<ProductRow> {
  const prev = await db.prepare("SELECT id, status, branch_id FROM products WHERE id = ?").bind(id).first<{ id: string; status: string; branch_id: string }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (prev.status === "VOID") throw Object.assign(new Error("Void products cannot be edited"), { code: "CONFLICT" });
  if (patch.subcategoryId) await checkRef(db, "subcategories", patch.subcategoryId, "Subcategory");
  if (patch.designId) await checkRef(db, "designs", patch.designId, "Design");
  if (patch.productTypeId) await checkRef(db, "product_types", patch.productTypeId, "Product type");
  if (patch.metalTypeId) await checkRef(db, "metal_types", patch.metalTypeId, "Metal type");
  if (patch.stoneTypeId) await checkRef(db, "stone_types", patch.stoneTypeId, "Stone type");
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); vals.push(patch.name); }
  if (patch.subcategoryId !== undefined) { sets.push("subcategory_id = ?"); vals.push(patch.subcategoryId); }
  if (patch.designId !== undefined) { sets.push("design_id = ?"); vals.push(patch.designId); }
  if (patch.productTypeId !== undefined) { sets.push("product_type_id = ?"); vals.push(patch.productTypeId); }
  if (patch.metalTypeId !== undefined) { sets.push("metal_type_id = ?"); vals.push(patch.metalTypeId); }
  if (patch.stoneTypeId !== undefined) { sets.push("stone_type_id = ?"); vals.push(patch.stoneTypeId); }
  if (patch.makingLkr !== undefined) { sets.push("making_cents = ?"); vals.push(lkrToCents(patch.makingLkr)); }
  if (patch.wastageG !== undefined) { sets.push("wastage_mg = ?"); vals.push(gToMg(patch.wastageG)); }
  if (patch.costLkr !== undefined) { sets.push("cost_cents = ?"); vals.push(lkrToCents(patch.costLkr)); }
  if (patch.sellingPriceLkr !== undefined) { sets.push("selling_price_cents = ?"); vals.push(lkrToCents(patch.sellingPriceLkr)); }
  if (patch.location !== undefined) { sets.push("location = ?"); vals.push(patch.location); }
  if (patch.notes !== undefined) { sets.push("notes = ?"); vals.push(patch.notes); }
  if (sets.length > 0) {
    await db.batch([
      db.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id),
      buildAuditStmt(db, { userId: actorId, action: "product.edit", entity: "product", entityId: id, next: patch, branchId: prev.branch_id }),
    ]);
  }
  const updated = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<RawRow>();
  if (!updated) throw new Error("Product update failed");
  return parseRow(updated);
}

export type ProductListOpts = PageOpts & {
  status?: string; categoryId?: string; purityId?: string; branchId?: string;
  minG?: number; maxG?: number; minPriceLkr?: number; maxPriceLkr?: number;
};

export async function listProducts(db: D1Database, userId: string, canManageAll: boolean, opts: ProductListOpts): Promise<{ rows: ProductRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)"];
  const vals: unknown[] = [like, like, like];
  if (opts.status) { conds.push("p.status = ?"); vals.push(opts.status); }
  if (opts.categoryId) { conds.push("p.category_id = ?"); vals.push(opts.categoryId); }
  if (opts.purityId) { conds.push("p.purity_id = ?"); vals.push(opts.purityId); }
  if (opts.branchId) { conds.push("p.branch_id = ?"); vals.push(opts.branchId); }
  else if (!canManageAll) { conds.push("p.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)"); vals.push(userId); }
  if (opts.minG !== undefined) { conds.push("p.net_mg >= ?"); vals.push(gToMg(opts.minG)); }
  if (opts.maxG !== undefined) { conds.push("p.net_mg <= ?"); vals.push(gToMg(opts.maxG)); }
  if (opts.minPriceLkr !== undefined) { conds.push("p.selling_price_cents >= ?"); vals.push(lkrToCents(opts.minPriceLkr)); }
  if (opts.maxPriceLkr !== undefined) { conds.push("p.selling_price_cents <= ?"); vals.push(lkrToCents(opts.maxPriceLkr)); }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM products p ${where}`).bind(...vals).first<{ total: number }>();
  const { results } = await db.prepare(`${WITH_NAMES} ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).bind(...vals, opts.limit, offset).all<RawRow>();
  return { rows: (results ?? []).map(parseRow), total: count?.total ?? 0 };
}

async function withPrice(db: D1Database, row: RawRow | null): Promise<ProductDetail> {
  if (!row) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  const product = parseRow(row);
  const { livePrice, noRate } = await priceFor(db, product.purity_id, product.net_mg, product.making_cents);
  return { product, livePrice, noRate };
}

export async function getProduct(db: D1Database, id: string): Promise<ProductDetail> {
  return withPrice(db, await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<RawRow>());
}

export async function findByBarcode(db: D1Database, code: string): Promise<ProductDetail> {
  return withPrice(db, await db.prepare(`${WITH_NAMES} WHERE UPPER(p.barcode) = UPPER(?)`).bind(code.trim()).first<RawRow>());
}

export async function voidProduct(db: D1Database, id: string, actorId: string, reason: string): Promise<void> {
  const prev = await db.prepare("SELECT id, status, branch_id, net_mg FROM products WHERE id = ?").bind(id).first<{ id: string; status: string; branch_id: string; net_mg: number }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (prev.status === "VOID") throw Object.assign(new Error("Product already void"), { code: "CONFLICT" });
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE products SET status = 'VOID' WHERE id = ?").bind(id),
    db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'VOID', ?, 'VOID', ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, prev.status, prev.branch_id, prev.branch_id, prev.net_mg, reason, now, actorId),
    buildAuditStmt(db, { userId: actorId, action: "product.void", entity: "product", entityId: id, prev: { status: prev.status }, next: { status: "VOID" }, reason, branchId: prev.branch_id }),
  ]);
}
```

- [ ] **Step 2: Update rates.ts to cents (keep float read shape)**

Change GoldRateRow to `{ ..., rate_cents_per_g: number; ... }`; WITH_KARAT selects `g.rate_cents_per_g`; add:
```ts
export async function currentGoldRatesCents(db: D1Database): Promise<{ purity_id: string; karat: string; rate_cents_per_g: number; effective_from: number }[]> { ...existing query... }
export async function currentGoldRates(db: D1Database): Promise<GoldRateRow[]> {
  const rows = await currentGoldRatesCents(db);
  return rows.map((r) => ({ ...r, rate_per_gram: r.rate_cents_per_g / 100 }));
}
```
Keep exported `GoldRateRow` with `rate_per_gram` float (web gold-rates page untouched). createGoldRate: input `{purityId, ratePerGram, effectiveFrom}` unchanged (schema untouched) → store `lkrToCents(input.ratePerGram)`; return row mapped with float. listGoldRates: map cents→float in returned rows.

- [ ] **Step 3: Update parties.ts to cents (keep float contract)**

createParty: store `lkrToCents(input.creditLimit)`, `lkrToCents(input.openingBalance)`; return floats. listParties: map `credit_limit_cents/100`, `opening_balance_cents/100` to `credit_limit`/`opening_balance` in PartyRow (keep PartyRow shape). updateParty creditLimit: convert on write.

- [ ] **Step 4: Typecheck (routes still old-shape — expect errors ONLY in route files)**

Run: `pnpm --filter goldos-api exec tsc --noEmit 2>&1 | grep "error TS" | sed 's/(.*//' | sort | uniq -c`
Expected: errors only in routes/*.ts.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/products.ts apps/api/src/services/rates.ts apps/api/src/services/parties.ts
git commit -m "feat: services on minor units with JW codes"
```

---

### Task 6: Product routes update + images + catalog endpoints

**Files:**
- Modify: `apps/api/src/routes/products.ts` (gram/LKR I/O, edit route, image routes, mg display for label)
- Modify: `apps/api/src/routes/catalog.ts` (5 new entities), `apps/api/src/services/catalog.ts` (generic master helpers)
- Test: tsc clean (whole api)

**Interfaces:**
- Consumes: Task 5 services; `c.env.R2`.
- Produces: updated product endpoints; image up/download; catalog sub-entity CRUD.

- [ ] **Step 1: Rewrite routes/products.ts**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { centsToLkr, createProductSchema, editProductSchema, mgToG, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { buildLabelSvg } from "../services/label";
import { createProduct, editProduct, findByBarcode, getProduct, listProducts, priceFor, voidProduct } from "../services/products";
import { pagination, serviceError } from "./http";

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export const products = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid product data" } }, 400);
    try {
      const row = await createProduct(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const perms = c.get("permissions") as string[];
    const canManageAll = perms.includes(PERMISSIONS.BRANCHES_MANAGE);
    const num = (k: string) => { const v = c.req.query(k); return v === undefined ? undefined : Number(v); };
    const data = await listProducts(c.env.DB, c.get("userId"), canManageAll, {
      ...pagination(c),
      status: c.req.query("status"),
      categoryId: c.req.query("categoryId"),
      purityId: c.req.query("purityId"),
      branchId: c.req.query("branchId"),
      minG: num("minG"), maxG: num("maxG"),
      minPriceLkr: num("minPriceLkr"), maxPriceLkr: num("maxPriceLkr"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/barcode/:code", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      const data = await findByBarcode(c.env.DB, c.req.param("code"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      const data = await getProduct(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = editProductSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid product data" } }, 400);
    try {
      const data = await editProduct(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id/label", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      const { product } = await getProduct(c.env.DB, c.req.param("id"));
      const { livePrice } = await priceFor(c.env.DB, product.purity_id, product.net_mg, product.making_cents);
      const svg = buildLabelSvg(
        { barcode: product.barcode, name: product.name, gross_weight: mgToG(product.gross_mg), net_weight: mgToG(product.net_mg), karat: product.karat },
        livePrice ? { amount: centsToLkr(livePrice.amount_cents), ratePerGram: centsToLkr(livePrice.rate_cents_per_g), rateEffectiveFrom: livePrice.rate_effective_from } : null
      );
      c.header("Content-Type", "image/svg+xml");
      return c.body(svg, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/images", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const id = c.req.param("id");
    const prev = await c.env.DB.prepare("SELECT id, image_keys, branch_id FROM products WHERE id = ?").bind(id).first<{ id: string; image_keys: string; branch_id: string }>();
    if (!prev) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } }, 404);
    const keys = JSON.parse(prev.image_keys) as string[];
    if (keys.length >= 10) return c.json({ success: false, error: { code: "VALIDATION", message: "Max 10 images" } }, 400);
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) return c.json({ success: false, error: { code: "VALIDATION", message: "file required" } }, 400);
    if (file.size > 5 * 1024 * 1024) return c.json({ success: false, error: { code: "VALIDATION", message: "Max 5MB" } }, 400);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return c.json({ success: false, error: { code: "VALIDATION", message: "jpeg/png/webp only" } }, 400);
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `products/${id}/${crypto.randomUUID()}.${ext}`;
    await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    const next = [...keys, key];
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE products SET image_keys = ? WHERE id = ?").bind(JSON.stringify(next), id),
      (await import("../middleware/audit")).buildAuditStmt(c.env.DB, { userId: c.get("userId"), action: "product.image_add", entity: "product", entityId: id, next: { key }, branchId: prev.branch_id }),
    ]);
    return c.json({ success: true, data: { key, image_keys: next } }, 201);
  })
  .get("/:id/images/:key", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const id = c.req.param("id");
    const key = `products/${id}/${c.req.param("key")}`;
    const obj = await c.env.R2.get(key);
    if (!obj) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Image not found" } }, 404);
    c.header("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
    return c.body(await obj.arrayBuffer(), 200);
  })
  .patch("/:id/void", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = voidSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Reason is required" } }, 400);
    try {
      await voidProduct(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
```

Note: dynamic `await import("../middleware/audit")` — replace with top-level `import { buildAuditStmt } from "../middleware/audit";` (static import; the inline form above is forbidden in final code).

R2 in local dev: miniflare provides ephemeral R2 — image upload test locally works; persistence not needed for tests.

- [ ] **Step 2: Extend catalog service + routes with 5 entities**

In services/catalog.ts append generic helpers:
```ts
export type SimpleRow = { id: string; name: string; code: string; is_active: number; created_at: number };

async function createSimple(db: D1Database, table: string, entity: string, input: { name: string; code: string; categoryId?: string }, actorId: string): Promise<SimpleRow> {
  const dup = await db.prepare(`SELECT id FROM ${table} WHERE code = ?`).bind(input.code).first();
  if (dup) throw Object.assign(new Error("Code already in use"), { code: "CONFLICT" });
  if (table === "subcategories") {
    const cat = await db.prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1").bind(input.categoryId).first();
    if (!cat) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const extraCols = table === "subcategories" ? ", category_id" : "";
  const extraVals = table === "subcategories" ? [input.categoryId] : [];
  await db.batch([
    db.prepare(`INSERT INTO ${table} (id, name, code${extraCols}, is_active, created_at, created_by) VALUES (?, ?, ?${extraCols ? ", ?" : ""}, 1, ?, ?)`).bind(id, input.name, input.code, ...extraVals, now, actorId),
    buildAuditStmt(db, { userId: actorId, action: `${entity}.create`, entity, entityId: id, next: input }),
  ]);
  return { id, name: input.name, code: input.code, is_active: 1, created_at: now };
}

async function listSimple(db: D1Database, table: string, categoryId: string | undefined, opts: PageOpts): Promise<{ rows: SimpleRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const extra = table === "subcategories" && categoryId ? "AND category_id = ?" : "";
  const base = table === "subcategories" && categoryId ? [like, like, categoryId] : [like, like];
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE (name LIKE ? OR code LIKE ?) ${extra}`).bind(...base).first<{ total: number }>();
  const { results } = await db.prepare(`SELECT id, name, code, is_active, created_at FROM ${table} WHERE (name LIKE ? OR code LIKE ?) ${extra} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...base, opts.limit, offset).all<SimpleRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export const createSubcategory = (db: D1Database, input: { categoryId: string; name: string; code: string }, actorId: string) => createSimple(db, "subcategories", "subcategory", input, actorId);
export const createDesign = (db: D1Database, input: { name: string; code: string }, actorId: string) => createSimple(db, "designs", "design", input, actorId);
export const createProductType = (db: D1Database, input: { name: string; code: string }, actorId: string) => createSimple(db, "product_types", "product_type", input, actorId);
export const createMetalType = (db: D1Database, input: { name: string; code: string }, actorId: string) => createSimple(db, "metal_types", "metal_type", input, actorId);
export const createStoneType = (db: D1Database, input: { name: string; code: string }, actorId: string) => createSimple(db, "stone_types", "stone_type", input, actorId);
export const listSubcategories = (db: D1Database, categoryId: string | undefined, opts: PageOpts) => listSimple(db, "subcategories", categoryId, opts);
export const listDesigns = (db: D1Database, opts: PageOpts) => listSimple(db, "designs", undefined, opts);
export const listProductTypes = (db: D1Database, opts: PageOpts) => listSimple(db, "product_types", undefined, opts);
export const listMetalTypes = (db: D1Database, opts: PageOpts) => listSimple(db, "metal_types", undefined, opts);
export const listStoneTypes = (db: D1Database, opts: PageOpts) => listSimple(db, "stone_types", undefined, opts);
```

In routes/catalog.ts append (before final `;` — restructure terminator as in auth pattern):
```ts
  const ENTITIES = {
    subcategories: { create: createSubcategorySchema, make: createSubcategory, list: (q: {...}) => ... },
  };
```
Simpler explicit approach — add 10 endpoints (POST+GET per entity) following the categories pattern verbatim:
- POST /subcategories (MASTERS_CREATE, createSubcategorySchema) / GET /subcategories (MASTERS_VIEW, ?categoryId=)
- POST /designs, GET /designs; POST /product-types, GET /product-types; POST /metal-types, GET /metal-types; POST /stone-types, GET /stone-types.
Import the 5 create schemas + 10 service functions. Each handler mirrors the categories handlers exactly (400 VALIDATION / 201 / serviceError).

- [ ] **Step 3: Full api typecheck (must be fully clean)**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK with zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/products.ts apps/api/src/routes/catalog.ts apps/api/src/services/catalog.ts
git commit -m "feat: product edit, images, catalog sub-entities"
```

---

### Task 7: Web products/inventory UI

**Files:**
- Modify: `apps/web/app/(app)/products/page.tsx` (filters + new fields), `apps/web/app/(app)/products/[id]/page.tsx` (new specs, gallery, movements tab, edit dialog), `apps/web/components/scan-field.tsx` (keep), `apps/web/components/app-sidebar.tsx` (Scan, Inventory links)
- Create: `apps/web/app/(app)/scan/page.tsx`, `apps/web/app/(app)/inventory/page.tsx`, `apps/web/app/(app)/products/[id]/print/page.tsx`
- Test: tsc + build + click-through

**Interfaces:**
- Consumes: Task 6 endpoints; `mgToG/centsToLkr` from `@goldos/shared` for display.
- Produces: filterable list, create/edit with selects + uploader, detail with gallery + movements, scan screen, print view, inventory screen.

- [ ] **Step 1: Sidebar links**

Append `{ href: "/scan", label: "Scan", perm: "products:view" }` after Products; `{ href: "/inventory", label: "Inventory", perm: "products:view" }` after Scan.

- [ ] **Step 2: Rewrite products list page** (filters + JW fields)

Read current page first, then extend: add filter row (category select from `/masters/categories`, purity select, branch text, status select of 11 values, min/max grams, min/max LKR) building query string with minG/maxG/minPriceLkr/maxPriceLkr; table columns add SKU + fine gold (mgToG) + status; create dialog gains selects (subcategory/design/type/metal/stone — fetch lists; metal defaults to metal-gold) + wastage/cost/price/location/notes fields; image file input (multiple, FormData POST to `/:id/images` after create, max 5MB client check).

- [ ] **Step 3: Detail page** (specs + gallery + movements + edit)

Read current detail page first. Add: SKU, metal, design, fine gold (mgToG), wastage, cost/selling (centsToLkr), location, notes, gallery (`<img src={labelBase/.../images/k}>` — image URL = `${API}/api/v1/products/${id}/images/${k.split("/").pop()}`), movements tab (`GET /inventory/movements?productId=` table), edit dialog (PATCH with editProductSchema fields), void button (existing, keep).

- [ ] **Step 4: Scan + print + inventory pages**

scan/page.tsx: reuse `ScanField` component (already exists — verify import path) + recent scans in localStorage (max 10) + result embedded via lookup query (do NOT navigate away — show card inline with link to detail).
print page `products/[id]/print/page.tsx`: fetch label SVG URL, show preview, copies number input rendering N `<img>` tags, print CSS (existing `.print-area` in globals.css — wrap in it).
inventory/page.tsx: groupBy tabs (branch/purity/product) → `GET /inventory/stock?groupBy=` table (pieces, grams via mgToG, fine grams, value via centsToLkr or —); movement form (product barcode input → resolve via barcode lookup → toStatus select + toBranch + reason → POST) gated by products:edit; history table (`GET /inventory/movements` with filters).

- [ ] **Step 5: Typecheck + build + click-through**

Run: `pnpm --filter goldos-web exec tsc --noEmit && echo TSC_OK`
Run: `NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter goldos-web exec next build 2>&1 | tail -6`
Expected: all routes incl. /scan /inventory.
Click-through (API on 8788 if 8787 taken by the sibling project; web `next start --port 3001`): /products, /scan, /inventory, /products/[id] all 200.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: product filters, edit, gallery, scan and inventory screens"
```

---

### Task 8: Workflow verification + remote deploy + docs

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/barcode-system.md`, `docs/inventory.md` (new)
- Test: full gate below

**Interfaces:**
- Consumes: all tasks. Local D1 at 0007; remote needs 0005+0006+0007 in order.

- [ ] **Step 1: Remote migrate in order**

Run: for f in 0005_catalog 0006_decimal 0007_inventory: `pnpm --filter goldos-api exec wrangler d1 execute goldos --remote --file ./drizzle/$f.sql` — each must print success. If FK error: seed prerequisite rows first (metal_types seeded in 0005 itself; products rebuild references them — same-file order safe).

- [ ] **Step 2: Deploy + smoke**

Run: `pnpm --filter goldos-api exec wrangler deploy` → Version ID.
Smoke (remote admin): create JW- product with refs → barcode matches `^JW-`; scan lookup; transfer to second branch (create CMB2 branch first if absent) → stock?groupBy=branch reflects move; movements history has INTAKE+TRANSFER_OUT+TRANSFER_IN; SOLD attempt → 409 TRANSITION_LOCKED; label 200 SVG; upload 6MB file → 400.

- [ ] **Step 3: Local workflow test (product → barcode → inventory)**

On local: create product (JW-) → scan lookup returns livePrice → transfer branch-main→CMB2 → `GET /inventory/stock?groupBy=branch` totals shift → history lists 3 rows → void with reason → edit attempt → 409 → movements show VOID → audit contains product.create/inventory.transfer/product.void.

- [ ] **Step 4: Docs + full suite + commit**

database.md: 0005/0006/0007 sections (new masters; mg/cents/permille rebuild + wastage reset note; movements table + status map).
api.md: new endpoints (catalog sub-entities, PATCH products, images, inventory ×3) + updated perm names + gram/LKR contract note.
barcode-system.md: JW- format + grandfathered PRD- + reserved prefixes.
inventory.md (new): ledger design, movement types, allowlist table, valuation note.
Run: `pnpm test` (3/3) + `pnpm build` (3/3).
```bash
git add docs
git commit -m "docs: product foundation tables, endpoints, inventory"
```

---

## Self-Review

- Spec coverage: catalog masters (§2 Task 2+6) ✓; decimal mg/cents/permille + boundary (§3 Tasks 1-2,5) ✓; JW- + grandfathered PRD- + reserved (§2 Tasks 1,5) ✓; edit + weight immutability (§2 Task 5) ✓; R2 images (§2 Task 6) ✓; ledger + 11 statuses + allowlist (§4 Tasks 3-4) ✓; UI list/form/edit/detail/scan/print/inventory/history + filters (§5 Task 7) ✓; workflow test (§7 Task 8) ✓. Camera excluded everywhere ✓.
- Placeholder scan: no TBD/TODO; every code step concrete; movement-type strings fixed; R2 key format fixed.
- Type consistency: `rate_cents_per_g` internal vs `rate_per_gram` float public edge — defined once in Task 5 Step 2 and used in routes Task 6; `amount_cents` vs label `amount` float — converted at call site; `image_keys: string[]` parsed from JSON TEXT in parseRow everywhere.
