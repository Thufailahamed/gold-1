# GoldOS Phase-3 Products + Barcodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship unique-piece product catalog with auto PRD- barcodes, live pricing, Code128 SVG labels, and scan lookup, in UI + API, migrated and deployed to Cloudflare.

**Architecture:** Per-domain module `products` following Phase-1/2 patterns: shared Zod schema, service owns D1 with batch + audit, paginated lists, `{ success, data }` envelope. Barcode generated server-side (`PRD-` + 6 chars, DB-checked, 5 retries). Labels rendered on demand with `bwip-js` `toSVG` (Workers-safe, no DOM) wrapped in a label SVG with text lines — no R2 storage. Live price reuses `currentGoldRates()`.

**Tech Stack:** Hono, Drizzle ORM, Cloudflare D1/Workers, `bwip-js@^4`, Next.js 16, React 19, TanStack Query v5, RHF + Zod.

## Global Constraints

- Every write batches business row + audit_logs; failure rolls back.
- No hard deletes; void with reason; no route ever sets status `sold`.
- Strict TypeScript, no `any`; Zod client + server; typed responses.
- Products carry `branch_id`; net = gross − stone, reject negatives.
- Rates never hard-coded; no live rate → `livePrice: null` + `no_rate: true`.
- Permissions `products:read`, `products:write`; admin+manager both, cashier read, viewer none.
- Barcode format `^PRD-[A-Z0-9]{6}$`, alphabet excludes 0/O/1/I.

---

## File Structure

- Modify: `packages/shared/src/schemas.ts` (append), `packages/shared/src/permissions.ts` (perms + roles)
- Create: `packages/shared/src/products.test.ts`
- Create: `apps/api/drizzle/0003_products.sql`
- Modify: `apps/api/src/db/schema.ts` (append), `apps/api/src/seed.ts`, `apps/api/src/app.ts` (mount)
- Create: `apps/api/src/services/products.ts`, `apps/api/src/services/label.ts`, `apps/api/src/routes/products.ts`
- Create: `apps/web/app/(app)/products/page.tsx`, `apps/web/app/(app)/products/[id]/page.tsx`, `apps/web/components/scan-field.tsx`
- Modify: `apps/web/components/app-sidebar.tsx` (Products link), `apps/web/app/globals.css` (print rules)
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/barcode-system.md`

`products.ts` = CRUD + barcode gen + live price. `label.ts` = SVG label builder (pure function of product + price, unit-testable without DB). Routes parse/validate only.

---

### Task 1: Shared product schema + permissions

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append)
- Modify: `packages/shared/src/permissions.ts` (3 edits)
- Create: `packages/shared/src/products.test.ts`
- Test: `packages/shared/src/products.test.ts`

**Interfaces:**
- Consumes: existing `z`, `PERMISSIONS`, `DEFAULT_ROLES`.
- Produces: `createProductSchema` + `CreateProductInput`; `BARCODE_RE`; `PERMISSIONS.PRODUCTS_READ/PRODUCTS_WRITE`; updated `DEFAULT_ROLES`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/products.test.ts
import { describe, expect, it } from "vitest";
import { BARCODE_RE, createProductSchema } from "./schemas";

describe("product schema", () => {
  const valid = {
    name: "22K Wedding Ring",
    categoryId: "cat-ring",
    purityId: "purity-22k",
    grossWeight: 5.2,
    stoneWeight: 0.2,
    makingCharge: 15000,
    branchId: "branch-main",
  };
  it("accepts a valid product", () => {
    expect(createProductSchema.parse(valid).grossWeight).toBe(5.2);
  });
  it("rejects negative gross weight", () => {
    expect(() => createProductSchema.parse({ ...valid, grossWeight: -1 })).toThrow();
  });
  it("rejects negative stone weight", () => {
    expect(() => createProductSchema.parse({ ...valid, stoneWeight: -0.1 })).toThrow();
  });
  it("matches PRD- barcodes", () => {
    expect(BARCODE_RE.test("PRD-A3F9K2")).toBe(true);
    expect(BARCODE_RE.test("PRD-abc123")).toBe(false);
    expect(BARCODE_RE.test("OLD-ABC123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/products.test.ts`
Expected: FAIL (missing exports; note Phase-2 lesson — if it passes via TypeError-on-undefined, proceed anyway and confirm green is for the right reason in Step 5).

- [ ] **Step 3: Append to packages/shared/src/schemas.ts**

```ts
export const BARCODE_RE = /^PRD-[A-Z0-9]{6}$/;

export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().min(1),
  purityId: z.string().min(1),
  grossWeight: z.number().gt(0).max(100000),
  stoneWeight: z.number().min(0).max(100000).optional().default(0),
  makingCharge: z.number().min(0).optional().default(0),
  branchId: z.string().min(1),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
```

- [ ] **Step 4: Edit packages/shared/src/permissions.ts**

Edit 1 — append to PERMISSIONS:
```ts
  PRODUCTS_READ: "products:read",
  PRODUCTS_WRITE: "products:write",
```
Edit 2 — admin: append `"products:read", "products:write"` to admin array.
Edit 3 — manager: append `"products:read", "products:write"`; cashier: append `"products:read"`.

- [ ] **Step 5: Run test to verify it passes for the right reason**

Run: `pnpm exec vitest run packages/shared/src/products.test.ts && pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
Expected: 4 passed + TSC_OK. Sanity: temporarily break one assertion mentally — `BARCODE_RE.test("PRD-abc123")` is false only if regex enforces uppercase; confirmed by code read.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/permissions.ts packages/shared/src/products.test.ts
git commit -m "feat: product schema, barcode regex, permissions"
```

---

### Task 2: Migration 0003 + Drizzle + seed

**Files:**
- Create: `apps/api/drizzle/0003_products.sql`
- Modify: `apps/api/src/db/schema.ts` (append + nothing else)
- Modify: `apps/api/src/seed.ts` (perms + grants)
- Test: local apply + remote apply

**Interfaces:**
- Consumes: Task 1 permission strings.
- Produces: `products` table local + remote; Drizzle `products` export; seed updated.

- [ ] **Step 1: Write apps/api/drizzle/0003_products.sql**

```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  purity_id TEXT NOT NULL REFERENCES purities(id),
  name TEXT NOT NULL,
  gross_weight REAL NOT NULL,
  stone_weight REAL NOT NULL DEFAULT 0,
  net_weight REAL NOT NULL,
  making_charge REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_stock',
  branch_id TEXT NOT NULL REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_branch_status ON products(branch_id, status);
INSERT INTO permissions (id, name) VALUES ('products:read', 'products:read'), ('products:write', 'products:write');
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'products:read'), ('admin', 'products:write'),
  ('manager', 'products:read'), ('manager', 'products:write'),
  ('cashier', 'products:read');
```

- [ ] **Step 2: Append Drizzle table**

```ts
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  barcode: text("barcode").notNull().unique(),
  categoryId: text("category_id").notNull(),
  purityId: text("purity_id").notNull(),
  name: text("name").notNull(),
  grossWeight: real("gross_weight").notNull(),
  stoneWeight: real("stone_weight").notNull().default(0),
  netWeight: real("net_weight").notNull(),
  makingCharge: real("making_charge").notNull().default(0),
  status: text("status").notNull().default("in_stock"),
  branchId: text("branch_id").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});
```

- [ ] **Step 3: Update apps/api/src/seed.ts**

Append `"products:read", "products:write",` to SEED_PERMISSIONS; admin add both, manager add both, cashier add `"products:read"`.

- [ ] **Step 4: Apply local AND remote, verify**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0003_products.sql 2>&1 | tail -2`
Expected: success.
Run: `pnpm --filter goldos-api exec wrangler d1 execute goldos --remote --file ./drizzle/0003_products.sql 2>&1 | grep -E "success|ERROR" | head -3`
Expected: `"success": true`. (Remote roles/permissions rows exist from cloud setup, so grant INSERTs satisfy FKs. If FK error: seed roles first, as documented in deployment history.)
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 5: Commit**

```bash
git add apps/api/drizzle/0003_products.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: products table, migration, seed"
```

---

### Task 3: Products service (CRUD + barcode + live price)

**Files:**
- Create: `apps/api/src/services/products.ts`
- Test: typecheck + live curl in Task 5

**Interfaces:**
- Consumes: `buildAuditStmt`; `CreateProductInput`, `BARCODE_RE` from shared; `currentGoldRates` from `./rates`; `PageOpts` from `./catalog`.
- Produces: `createProduct, listProducts, getProduct, voidProduct, findByBarcode, priceFor` — signatures below; routes consume in Task 4.

- [ ] **Step 1: Write apps/api/src/services/products.ts**

```ts
import { BARCODE_RE, type CreateProductInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { currentGoldRates } from "./rates";

export type ProductRow = {
  id: string;
  barcode: string;
  category_id: string;
  category_name: string;
  purity_id: string;
  karat: string;
  name: string;
  gross_weight: number;
  stone_weight: number;
  net_weight: number;
  making_charge: number;
  status: string;
  branch_id: string;
  created_at: number;
};

export type LivePrice = {
  amount: number;
  ratePerGram: number;
  rateEffectiveFrom: number;
} | null;

export type ProductDetail = { product: ProductRow; livePrice: LivePrice; noRate: boolean };

const WITH_NAMES =
  "SELECT p.id, p.barcode, p.category_id, c.name AS category_name, p.purity_id, pu.karat, p.name, p.gross_weight, p.stone_weight, p.net_weight, p.making_charge, p.status, p.branch_id, p.created_at FROM products p JOIN categories c ON c.id = p.category_id JOIN purities pu ON pu.id = p.purity_id";

const BARCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomBarcode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = "PRD-";
  for (const b of bytes) s += BARCODE_ALPHABET[b % BARCODE_ALPHABET.length];
  return s;
}

export async function priceFor(db: D1Database, purityId: string, netWeight: number, makingCharge: number): Promise<{ livePrice: LivePrice; noRate: boolean }> {
  const rates = await currentGoldRates(db);
  const rate = rates.find((r) => r.purity_id === purityId);
  if (!rate) return { livePrice: null, noRate: true };
  return {
    livePrice: {
      amount: Math.round((netWeight * rate.rate_per_gram + makingCharge) * 100) / 100,
      ratePerGram: rate.rate_per_gram,
      rateEffectiveFrom: rate.effective_from,
    },
    noRate: false,
  };
}

export async function createProduct(
  db: D1Database,
  input: CreateProductInput,
  actorId: string
): Promise<ProductRow> {
  const category = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1")
    .bind(input.categoryId)
    .first<{ id: string }>();
  if (!category) throw Object.assign(new Error("Category not found or inactive"), { code: "NOT_FOUND" });
  const purity = await db
    .prepare("SELECT id FROM purities WHERE id = ? AND is_active = 1")
    .bind(input.purityId)
    .first<{ id: string }>();
  if (!purity) throw Object.assign(new Error("Purity not found or inactive"), { code: "NOT_FOUND" });
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first<{ id: string }>();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const net = input.grossWeight - input.stoneWeight;
  if (net <= 0) throw Object.assign(new Error("Stone weight must be less than gross weight"), { code: "VALIDATION" });

  let barcode = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomBarcode();
    if (!BARCODE_RE.test(candidate)) continue;
    const dup = await db.prepare("SELECT id FROM products WHERE barcode = ?").bind(candidate).first();
    if (!dup) {
      barcode = candidate;
      break;
    }
  }
  if (!barcode) throw Object.assign(new Error("Could not generate unique barcode"), { code: "INTERNAL" });

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO products (id, barcode, category_id, purity_id, name, gross_weight, stone_weight, net_weight, making_charge, status, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_stock', ?, ?, ?)"
      )
      .bind(id, barcode, input.categoryId, input.purityId, input.name, input.grossWeight, input.stoneWeight, net, input.makingCharge, input.branchId, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "product.create",
      entity: "product",
      entityId: id,
      next: { ...input, barcode, net_weight: net },
      branchId: input.branchId,
    }),
  ]);
  const created = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<ProductRow>();
  if (!created) throw new Error("Product insert failed");
  return created;
}

export type ProductListOpts = PageOpts & { status?: string; categoryId?: string; branchId?: string };

export async function listProducts(
  db: D1Database,
  userId: string,
  canManageAll: boolean,
  opts: ProductListOpts
): Promise<{ rows: ProductRow[]; total: number }> {
  const like = `%${opts.search ?? ""}%`;
  const offset = (opts.page - 1) * opts.limit;
  const conds = ["(p.name LIKE ? OR p.barcode LIKE ?)"];
  const vals: unknown[] = [like, like];
  if (opts.status) {
    conds.push("p.status = ?");
    vals.push(opts.status);
  }
  if (opts.categoryId) {
    conds.push("p.category_id = ?");
    vals.push(opts.categoryId);
  }
  if (opts.branchId) {
    conds.push("p.branch_id = ?");
    vals.push(opts.branchId);
  } else if (!canManageAll) {
    conds.push("p.branch_id IN (SELECT branch_id FROM branch_members WHERE user_id = ?)");
    vals.push(userId);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM products p ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`${WITH_NAMES} ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...vals, opts.limit, offset)
    .all<ProductRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

async function withPrice(db: D1Database, row: ProductRow | null): Promise<ProductDetail> {
  if (!row) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  const { livePrice, noRate } = await priceFor(db, row.purity_id, row.net_weight, row.making_charge);
  return { product: row, livePrice, noRate };
}

export async function getProduct(db: D1Database, id: string): Promise<ProductDetail> {
  const row = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(id).first<ProductRow>();
  return withPrice(db, row);
}

export async function findByBarcode(db: D1Database, code: string): Promise<ProductDetail> {
  const row = await db
    .prepare(`${WITH_NAMES} WHERE UPPER(p.barcode) = UPPER(?)`)
    .bind(code.trim())
    .first<ProductRow>();
  return withPrice(db, row);
}

export async function voidProduct(db: D1Database, id: string, actorId: string, reason: string): Promise<void> {
  const prev = await db.prepare("SELECT id, status, branch_id FROM products WHERE id = ?").bind(id).first<{
    id: string;
    status: string;
    branch_id: string;
  }>();
  if (!prev) throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
  if (prev.status === "void") throw Object.assign(new Error("Product already void"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE products SET status = 'void' WHERE id = ?").bind(id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "product.void",
      entity: "product",
      entityId: id,
      prev: { status: prev.status },
      next: { status: "void" },
      reason,
      branchId: prev.branch_id,
    }),
  ]);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/products.ts
git commit -m "feat: products service with barcode gen and live price"
```

---

### Task 4: Label builder + routes + wiring

**Files:**
- Create: `apps/api/src/services/label.ts`
- Create: `apps/api/src/services/label.test.ts`
- Create: `apps/api/src/routes/products.ts`
- Modify: `apps/api/src/app.ts` (mount)
- Modify: `apps/api/package.json` (add `bwip-js@^4`)
- Test: label unit test + typecheck

**Interfaces:**
- Consumes: Task 3 service functions; `pagination`, `serviceError`; `requireAuth`, `requirePerm`; `PERMISSIONS.PRODUCTS_*`; `createProductSchema`.
- Produces: `buildLabelSvg(product, livePrice): string`; mounted `POST/GET /products`, `GET /products/:id`, `GET /products/barcode/:code`, `PATCH /products/:id/void`, `GET /products/:id/label`.

- [ ] **Step 1: Install bwip-js**

Run: `pnpm --filter goldos-api add bwip-js`
Expected: dependency added. Verify Workers-safety: `bwipjs.toSVG` is pure JS with no DOM/canvas use.

- [ ] **Step 2: Write failing label test**

```ts
// apps/api/src/services/label.test.ts
import { describe, expect, it } from "vitest";
import { buildLabelSvg } from "./label";

describe("buildLabelSvg", () => {
  it("embeds barcode, name, and price", () => {
    const svg = buildLabelSvg(
      { barcode: "PRD-A3F9K2", name: "22K Wedding Ring", gross_weight: 5.2, net_weight: 5.0, karat: "22K" },
      { amount: 157500, ratePerGram: 28500, rateEffectiveFrom: 1759000000000 }
    );
    expect(svg).toContain("PRD-A3F9K2");
    expect(svg).toContain("22K Wedding Ring");
    expect(svg).toContain("157500");
    expect(svg.startsWith("<svg")).toBe(true);
  });
  it("renders without price when no rate", () => {
    const svg = buildLabelSvg(
      { barcode: "PRD-A3F9K2", name: "Ring", gross_weight: 5.2, net_weight: 5.0, karat: "22K" },
      null
    );
    expect(svg).toContain("NO RATE");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run apps/api/src/services/label.test.ts`
Expected: FAIL (missing module).

- [ ] **Step 4: Write apps/api/src/services/label.ts**

```ts
import bwipjs from "bwip-js";

export type LabelProduct = {
  barcode: string;
  name: string;
  gross_weight: number;
  net_weight: number;
  karat: string;
};

export type LabelPrice = {
  amount: number;
  ratePerGram: number;
  rateEffectiveFrom: number;
} | null;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildLabelSvg(product: LabelProduct, price: LabelPrice): string {
  const bars = bwipjs.toSVG({
    bcid: "code128",
    text: product.barcode,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: "center",
  });
  const inner = bars.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const priceLine = price ? `${price.amount.toLocaleString()} LKR` : "NO RATE";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">` +
    `<text x="200" y="28" text-anchor="middle" font-size="20" font-family="sans-serif">${esc(product.name)}</text>` +
    `<text x="200" y="52" text-anchor="middle" font-size="14" font-family="sans-serif">${esc(product.karat)} · Gross ${product.gross_weight}g · Net ${product.net_weight}g</text>` +
    `<svg x="40" y="65" width="320" height="110" viewBox="0 0 320 110">${inner}</svg>` +
    `<text x="200" y="210" text-anchor="middle" font-size="22" font-weight="bold" font-family="sans-serif">${esc(priceLine)}</text>` +
    `<text x="200" y="234" text-anchor="middle" font-size="12" font-family="sans-serif">${esc(product.barcode)}</text>` +
    `</svg>`;
}
```

Note: if `bwipjs.toSVG` output lacks a viewBox, nested sizing may vary — acceptable for Phase 3; verify visually in Task 6 by opening the label URL in a browser.

- [ ] **Step 5: Write apps/api/src/routes/products.ts**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { createProductSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { buildLabelSvg } from "../services/label";
import {
  createProduct,
  findByBarcode,
  getProduct,
  listProducts,
  priceFor,
  voidProduct,
} from "../services/products";
import { pagination, serviceError } from "./http";

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export const products = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid product data" } },
        400
      );
    try {
      const row = await createProduct(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    const perms = c.get("permissions") as string[];
    const canManageAll = perms.includes(PERMISSIONS.BRANCHES_MANAGE);
    const data = await listProducts(c.env.DB, c.get("userId"), canManageAll, {
      ...pagination(c),
      status: c.req.query("status"),
      categoryId: c.req.query("categoryId"),
      branchId: c.req.query("branchId"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/barcode/:code", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    try {
      const data = await findByBarcode(c.env.DB, c.req.param("code"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    try {
      const data = await getProduct(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id/label", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    try {
      const { product } = await getProduct(c.env.DB, c.req.param("id"));
      const { livePrice } = await priceFor(c.env.DB, product.purity_id, product.net_weight, product.making_charge);
      const svg = buildLabelSvg(
        {
          barcode: product.barcode,
          name: product.name,
          gross_weight: product.gross_weight,
          net_weight: product.net_weight,
          karat: product.karat,
        },
        livePrice
      );
      c.header("Content-Type", "image/svg+xml");
      return c.body(svg, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id/void", requirePerm(PERMISSIONS.PRODUCTS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = voidSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await voidProduct(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
```

Route order matters: `/barcode/:code` is registered before `/:id` so `barcode/...` never matches the id route.

- [ ] **Step 6: Mount in apps/api/src/app.ts**

Add `import { products } from "./routes/products";` and `app.route("/api/v1/products", products);` after customers line.

- [ ] **Step 7: Run label test + typecheck**

Run: `pnpm exec vitest run apps/api/src/services/label.test.ts 2>&1 | tail -4`
Expected: PASS.
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/label.ts apps/api/src/services/label.test.ts apps/api/src/routes/products.ts apps/api/src/app.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat: product routes and svg labels"
```

---

### Task 5: Live API verification + deploy

**Files:** none (verification + deploy).

**Interfaces:**
- Consumes: Tasks 1–4. Local D1 has 0003 from Task 2; remote has 0003 from Task 
...[truncated 9113 chars]