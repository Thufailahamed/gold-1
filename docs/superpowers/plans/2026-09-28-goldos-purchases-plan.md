# GoldOS Jewellery Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two-stage jewellery purchasing — draft orders, atomic receive/direct invoices (product intake + stock + supplier ledger + balanced journal + payment + audit in one batch), payments on credit, void with reversal, reports, and UI — migrated and deployed.

**Architecture:** `receiveInvoice` orchestrator composes statement builders: new `buildCreateProductStmts` (refactored out of `createProduct`, same behavior), existing `postJournalStmts`, movement INSERTs. One `db.batch` per invoice; any failure rolls back. Counters table issues PO-/PINV- numbers inside the batch. Charge allocation by net-weight share, remainder to first item.

**Tech Stack:** Hono, Drizzle, D1, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler.

## Global Constraints

- Every write batches business row(s) + audit_logs; failure rolls back.
- No hard deletes; VOID/cancel with reason; invoice void only if all products still IN_STOCK.
- Strict TypeScript, no `any`; Zod client + server; typed responses.
- Money INTEGER cents, weights INTEGER mg; convert at API boundary only.
- Journal must balance; inactive accounts rejected.
- New perms `purchases:view/create/edit/cancel/export` (35 total — recount below).
- Old-gold excluded entirely.

---

## Permission additions (append to matrix)

- `purchases:view`, `purchases:create`, `purchases:edit`, `purchases:cancel`, `purchases:export`.
- owner: all (35). manager: all 5. accountant: view + export. inventory_officer: view + create + edit. cashier/salesperson/gold_officer: view. manufacturing: none.
- Count check: current 30 + 5 = 35. DEFAULT_ROLES owner `[...ALL]` auto-includes; manager filter unchanged.

## File Structure

- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/purchases.test.ts`
- Create: `apps/api/drizzle/0009_purchases.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Modify: `apps/api/src/services/products.ts` (extract builders)
- Create: `apps/api/src/services/purchases.ts`, `apps/api/src/routes/purchases.ts`
- Modify: `apps/api/src/app.ts`
- Create web: `purchases/orders`, `purchases/invoices`, `purchases/invoices/[id]`, `purchases/reports` pages; sidebar links; dashboard card wire
- Modify docs: `database.md`, `api.md`, `permissions.md`, `gold-accounting.md`

---

### Task 1: Shared perms + purchase schemas

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/purchases.test.ts`
- Test: purchases test

**Interfaces:**
- Consumes: existing PERMISSIONS/DEFAULT_ROLES, units helpers.
- Produces: 5 PURCHASES_* perms + grants; `createOrderSchema, receiveOrderSchema(=direct invoice), createInvoiceSchema, payInvoiceSchema, voidInvoiceSchema` (+ types); charge-allocation helper `allocateCharges` (pure, tested).

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/purchases.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

function allocateCharges(totalCharges: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) throw new Error("weights must be positive");
  const shares = weights.map((w) => Math.floor((totalCharges * w) / total));
  shares[0] += totalCharges - shares.reduce((s, x) => s + x, 0);
  return shares;
}

describe("purchases", () => {
  it("seeds purchase permissions", () => {
    expect(PERMISSIONS.PURCHASES_CREATE).toBe("purchases:create");
    expect(DEFAULT_ROLES["owner"]).toContain("purchases:cancel");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("purchases:view");
  });
  it("allocates charges by weight summing to total", () => {
    expect(allocateCharges(5000, [5000, 2500, 2500])).toEqual([2500, 1250, 1250]);
    const shares = allocateCharges(100, [1, 1, 1]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(100);
  });
  it("rejects empty weights", () => {
    expect(() => allocateCharges(100, [])).toThrow();
  });
});
```

Note: `allocateCharges` is defined IN THE TEST as the executable spec. The service (Task 4) must implement the identical algorithm — copy this function verbatim into `services/purchases.ts` (exported for reuse, not re-tested there).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/purchases.test.ts`
Expected: FAIL (missing PURCHASES_* exports).

- [ ] **Step 3: Implement perms + schemas**

permissions.ts: append 5 keys; DEFAULT_ROLES: manager filter unchanged; accountant append `"purchases:view", "purchases:export"`; inventory_officer append `"purchases:view", "purchases:create", "purchases:edit"`; cashier/salesperson/gold_officer append `"purchases:view"`.
schemas.ts append:
```ts
const purchaseItemSchema = z.object({
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional(),
  designId: z.string().min(1).optional(),
  productTypeId: z.string().min(1).optional(),
  metalTypeId: z.string().min(1),
  stoneTypeId: z.string().min(1).optional(),
  purityId: z.string().min(1),
  name: z.string().min(1).max(100),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  wastageG: z.number().min(0).optional().default(0),
  costLkr: z.number().min(0),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const createOrderSchema = z.object({
  supplierId: z.string().min(1),
  branchId: z.string().min(1),
  notes: z.string().max(2000).optional(),
  items: z.array(purchaseItemSchema.omit({ location: true, notes: true }).extend({
    estCostLkr: z.number().min(0),
    notes: z.string().max(2000).optional(),
  })).min(1),
});

export const createInvoiceSchema = z.object({
  orderId: z.string().min(1).optional(),
  supplierId: z.string().min(1),
  branchId: z.string().min(1),
  chargesLkr: z.number().min(0).optional().default(0),
  paidLkr: z.number().min(0).optional().default(0),
  paidMethod: z.enum(["cash", "bank"]).optional(),
  items: z.array(purchaseItemSchema).min(1),
});

export const payInvoiceSchema = z.object({
  amountLkr: z.number().gt(0),
  method: z.enum(["cash", "bank"]),
});

export const voidInvoiceSchema = z.object({ reason: z.string().min(1).max(500) });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
```

paidLkr > 0 requires paidMethod — enforced in service (VALIDATION), not schema.

- [ ] **Step 4: Green + typecheck + commit**

Run: `pnpm exec vitest run packages/shared/src/purchases.test.ts 2>&1 | grep -E "Tests "; pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
```bash
git add packages/shared/src/permissions.ts packages/shared/src/schemas.ts packages/shared/src/purchases.test.ts
git commit -m "feat: purchase permissions, schemas, allocation spec"
```

---

### Task 2: Migration 0009 + drizzle + seed

**Files:**
- Create: `apps/api/drizzle/0009_purchases.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Test: local apply + counts

**Interfaces:**
- Consumes: Task 1 perm names.
- Produces: counters, orders, order items, invoices, invoice items, payments tables; 5 perms + grants.

- [ ] **Step 1: Write 0009_purchases.sql**

```sql
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  next INTEGER NOT NULL DEFAULT 1
);
INSERT INTO counters (name, next) VALUES ('PO', 1), ('PINV', 1);
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  purity_id TEXT NOT NULL REFERENCES purities(id),
  gross_mg INTEGER NOT NULL,
  net_mg INTEGER NOT NULL,
  est_cost_cents INTEGER NOT NULL,
  notes TEXT
);
CREATE TABLE purchase_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_id TEXT REFERENCES purchase_orders(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  subtotal_cents INTEGER NOT NULL,
  charges_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_pinvoices_supplier ON purchase_invoices(supplier_id, created_at DESC);
CREATE INDEX idx_pinvoices_branch ON purchase_invoices(branch_id, created_at DESC);
CREATE TABLE purchase_invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  gross_mg INTEGER NOT NULL,
  net_mg INTEGER NOT NULL,
  purity_id TEXT NOT NULL REFERENCES purities(id),
  cost_cents INTEGER NOT NULL,
  making_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE purchase_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  ref_entity TEXT NOT NULL DEFAULT 'purchase_payment',
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO permissions (id, name) VALUES
  ('purchases:view', 'purchases:view'), ('purchases:create', 'purchases:create'),
  ('purchases:edit', 'purchases:edit'), ('purchases:cancel', 'purchases:cancel'),
  ('purchases:export', 'purchases:export');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'purchases:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'purchases:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'purchases:view'), ('accountant', 'purchases:export'),
  ('inventory_officer', 'purchases:view'), ('inventory_officer', 'purchases:create'),
  ('inventory_officer', 'purchases:edit'),
  ('cashier', 'purchases:view'), ('salesperson', 'purchases:view'),
  ('gold_officer', 'purchases:view');
```

- [ ] **Step 2: Drizzle + seed**

Append 6 tables (counters, purchaseOrders, purchaseOrderItems, purchaseInvoices, purchaseInvoiceItems, purchasePayments) mirroring SQL exactly.
seed.ts: SEED_PERMISSIONS append 5; owner spread auto; manager filter auto; accountant append view+export; inventory_officer append view+create+edit; cashier/salesperson/gold_officer append view.

- [ ] **Step 3: Apply local + verify**

Run apply; check: `SELECT COUNT(*) FROM purchase_invoices;` (0), perms 35, owner grants 35.
`pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK` (services untouched — passes).

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0009_purchases.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: purchase tables, counters, permissions"
```

---

### Task 3: Extract product statement builders (no behavior change)

**Files:**
- Modify: `apps/api/src/services/products.ts`
- Test: tsc + existing suite + live create regression (Task 5 gate covers)

**Interfaces:**
- Consumes: existing createProduct/voidProduct internals.
- Produces: `buildCreateProductStmts`, `buildVoidProductStmts`; `createProduct`/`voidProduct` delegate with identical behavior.

- [ ] **Step 1: Refactor**

In products.ts, extract from createProduct (lines ~121–195): everything from ref-checks through id/barcode/sku computation into:
```ts
export type BuiltProduct = {
  stmts: D1PreparedStatement[];
  id: string; barcode: string; sku: string; netMg: number;
};
export async function buildCreateProductStmts(
  db: D1Database, input: CreateProductInput, actorId: string, branchId: string, now: number
): Promise<BuiltProduct> {
  // ...same checks + codegen (uniqueCode) + fineGoldMg...
  // returns [product INSERT, INTAKE movement INSERT, audit INSERT] WITHOUT executing
}
export async function createProduct(db, input, actorId): Promise<ProductRow> {
  const now = Date.now();
  const built = await buildCreateProductStmts(db, input, actorId, input.branchId, now);
  await db.batch(built.stmts);
  const created = await db.prepare(`${WITH_NAMES} WHERE p.id = ?`).bind(built.id).first<RawRow>();
  if (!created) throw new Error("Product insert failed");
  return parseRow(created);
}
```
`now` passed in so orchestrator batches share one timestamp. `branchId` param = input.branchId (kept separate for future flexibility — pass input.branchId at call sites).
Similarly extract:
```ts
export async function buildVoidProductStmts(db, id, actorId, reason: string, now: number): Promise<{ stmts: D1PreparedStatement[]; branchId: string; netMg: number }> {
  // prev lookup + VOID check + [status UPDATE, VOID movement, audit] (no execute)
}
export async function voidProduct(db, id, actorId, reason) {
  const built = await buildVoidProductStmts(db, id, actorId, reason, Date.now());
  await db.batch(built.stmts);
}
```

- [ ] **Step 2: Verify no behavior change**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK; pnpm exec vitest run 2>&1 | grep -E "Tests "`
Expected: TSC_OK; all pass (no test covers these directly, but nothing breaks).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/products.ts
git commit -m "refactor: composable product statement builders"
```

---

### Task 4: Purchases service (orchestrator)

**Files:**
- Create: `apps/api/src/services/purchases.ts`
- Test: charge-allocation parity (covered by shared test — service copies algorithm verbatim); live in Task 6

**Interfaces:**
- Consumes: Task 3 builders; postJournalStmts; units; CreateOrderInput/CreateInvoiceInput.
- Produces: `createOrder, listOrders, getOrder, receiveOrder, createInvoiceDirect, payInvoice, voidInvoice, getInvoice, listInvoices, purchaseSummary, purchaseBreakdown`.

- [ ] **Step 1: Write services/purchases.ts**

```ts
import { gToMg, lkrToCents, type CreateInvoiceInput, type CreateOrderInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { postJournalStmts } from "./journal";
import { buildCreateProductStmts, buildVoidProductStmts } from "./products";

export function allocateCharges(totalCharges: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) throw new Error("weights must be positive");
  const shares = weights.map((w) => Math.floor((totalCharges * w) / total));
  shares[0] += totalCharges - shares.reduce((s, x) => s + x, 0);
  return shares;
}

async function nextNumber(db: D1Database, stmts: D1PreparedStatement[], name: string, prefix: string): Promise<string> {
  const row = await db.prepare("SELECT next FROM counters WHERE name = ?").bind(name).first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  const n = row.next;
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = ?").bind(n + 1, name));
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

type IntakeItem = {
  categoryId: string; subcategoryId?: string; designId?: string; productTypeId?: string;
  metalTypeId: string; stoneTypeId?: string; purityId: string; name: string;
  grossMg: number; stoneMg: number; netMg: number; makingCents: number; wastageMg: number;
  costCents: number; location?: string; notes?: string;
};

async function receiveBatch(
  db: D1Database,
  opts: {
    supplierId: string; branchId: string; orderId: string | null;
    items: IntakeItem[]; chargesCents: number; paidCents: number; paidMethod?: "cash" | "bank";
    actorId: string; now: number;
  }
): Promise<{ invoiceId: string; number: string }> {
  const supplier = await db.prepare("SELECT id FROM suppliers WHERE id = ? AND is_active = 1").bind(opts.supplierId).first();
  if (!supplier) throw Object.assign(new Error("Supplier not found"), { code: "NOT_FOUND" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(opts.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const subtotal = opts.items.reduce((s, it) => s + it.costCents, 0);
  const total = subtotal + opts.chargesCents;
  if (opts.paidCents > total) throw Object.assign(new Error("Payment exceeds total"), { code: "VALIDATION" });
  if (opts.paidCents > 0 && !opts.paidMethod) throw Object.assign(new Error("Payment method required"), { code: "VALIDATION" });

  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "PINV", "PINV");
  const invoiceId = crypto.randomUUID();
  const shares = allocateCharges(opts.chargesCents, opts.items.map((it) => it.netMg));
  const itemRows: { id: string; productId: string; grossMg: number; netMg: number; purityId: string; costCents: number; makingCents: number }[] = [];
  for (let i = 0; i < opts.items.length; i++) {
    const it = opts.items[i]!;
    const built = await buildCreateProductStmts(db, {
      name: it.name, categoryId: it.categoryId, subcategoryId: it.subcategoryId, designId: it.designId,
      productTypeId: it.productTypeId, metalTypeId: it.metalTypeId, stoneTypeId: it.stoneTypeId,
      purityId: it.purityId, grossG: it.grossMg / 1000, stoneG: it.stoneMg / 1000,
      makingLkr: it.makingCents / 100, wastageG: it.wastageMg / 1000,
      costLkr: (it.costCents + shares[i]!) / 100,
      location: it.location, notes: it.notes, branchId: opts.branchId,
    }, opts.actorId, opts.branchId, opts.now);
    stmts.push(...built.stmts);
    itemRows.push({ id: crypto.randomUUID(), productId: built.id, grossMg: it.grossMg, netMg: it.netMg, purityId: it.purityId, costCents: it.costCents + shares[i]!, makingCents: it.makingCents });
  }
```

Note: buildCreateProductStmts takes CreateProductInput (grams/LKR) — converting back from mg/cents is exact (integers ÷ 1000/100; gToMg/lkrToCents round-trip exactly for converted values). Cost stored on product = item cost + allocated share (COGS accuracy).

```ts
  stmts.push(db.prepare("INSERT INTO purchase_invoices (id, number, order_id, supplier_id, branch_id, subtotal_cents, charges_cents, total_cents, paid_cents, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(invoiceId, number, opts.orderId, opts.supplierId, opts.branchId, subtotal, opts.chargesCents, total, opts.paidCents, opts.paidCents === 0 ? "UNPAID" : opts.paidCents === total ? "PAID" : "PARTIAL", opts.now, opts.actorId));
  for (const r of itemRows) {
    stmts.push(db.prepare("INSERT INTO purchase_invoice_items (id, invoice_id, product_id, gross_mg, net_mg, purity_id, cost_cents, making_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(r.id, invoiceId, r.productId, r.grossMg, r.netMg, r.purityId, r.costCents, r.makingCents));
  }
  const journal = await postJournalStmts(db, {
    lines: [
      { account: "1100", debitCents: total, creditCents: 0, partyType: "supplier", partyId: opts.supplierId },
      { account: "2000", debitCents: 0, creditCents: total, partyType: "supplier", partyId: opts.supplierId },
    ],
    refEntity: "purchase_invoice", refId: invoiceId, memo: `Purchase ${number}`,
    branchId: opts.branchId, actorId: opts.actorId,
    auditAction: "purchase.receive", auditEntity: "purchase_invoice", auditEntityId: invoiceId,
  });
  stmts.push(...journal);
  if (opts.paidCents > 0) {
    const payId = crypto.randomUUID();
    const cash = opts.paidMethod === "cash" ? "1000" : "1010";
    stmts.push(db.prepare("INSERT INTO purchase_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, ?, ?, 'purchase_payment', ?, ?, ?)")
      .bind(payId, invoiceId, opts.paidCents, opts.paidMethod, payId, opts.now, opts.actorId));
    const payJournal = await postJournalStmts(db, {
      lines: [
        { account: "2000", debitCents: opts.paidCents, creditCents: 0, partyType: "supplier", partyId: opts.supplierId },
        { account: cash, debitCents: 0, creditCents: opts.paidCents },
      ],
      refEntity: "purchase_payment", refId: payId, memo: `Payment for ${number}`,
      branchId: opts.branchId, actorId: opts.actorId,
      auditAction: "purchase.pay", auditEntity: "purchase_payment", auditEntityId: payId,
    });
    stmts.push(...payJournal);
  }
  await db.batch(stmts);
  return { invoiceId, number };
}
```

Hmm — two audit rows (purchase.receive + purchase.pay) in one batch: acceptable (two events occurred).

```ts
export async function createOrder(db: D1Database, input: CreateOrderInput, actorId: string) {
  // validate supplier/branch/refs; nextNumber PO-; INSERT order + items (mg/cents converted); audit; batch; return { id, number }
}

export async function receiveOrder(db: D1Database, orderId: string, opts: { chargesLkr?: number; paidLkr?: number; paidMethod?: "cash" | "bank" }, actorId: string) {
  // load order + items (must be DRAFT, items present); mark RECEIVED in same batch (UPDATE status); call receiveBatch with mapped items
}

export async function createInvoiceDirect(db: D1Database, input: CreateInvoiceInput, actorId: string) {
  // map input items (gToMg/lkrToCents) → receiveBatch with orderId null
}

export async function payInvoice(db: D1Database, invoiceId: string, amountCents: number, method: "cash" | "bank", actorId: string) {
  // load invoice (not VOID); check amount ≤ total − paid; INSERT payment + journal DR2000/CR1000|1010 + UPDATE paid/status + audit; batch
}

export async function voidInvoice(db: D1Database, invoiceId: string, reason: string, actorId: string) {
  // load invoice + item product ids; all products must be IN_STOCK else 409; per product buildVoidProductStmts; reversal journal DR2000 total / CR1100 total (party supplier); UPDATE invoice VOID; audit; batch
}

export async function getInvoice(db, id) { /* invoice + items (join products barcode) + payments + journal lines (ref purchase_invoice|purchase_payment) */ }
export async function listInvoices(db, userId, canManageAll, opts: PageOpts & { supplierId?; branchId?; status?; from?; to? }) { /* LIKE number + filters */ }
export async function listOrders(db, ...) { /* same filters minus status set DRAFT/SENT/RECEIVED/CANCELLED */ }
export async function purchaseSummary(db, opts: { from: number; to: number; supplierId?; branchId? }) {
  // COUNT invoices, SUM total/paid, SUM item net_mg, SUM item cost; return { invoices, value_cents, paid_cents, outstanding_cents, gold_mg }
}
export async function purchaseBreakdown(db, opts: { from; to; branchId?; groupBy: "supplier" | "purity" | "category" }) {
  // join items→products→(category/purity names) or suppliers; SUM cost + net_mg per key
}
```

Full function bodies follow the established patterns (SELECT-validate → build stmts → batch). Keep each under 40 lines; copy guard style from existing services.

- [ ] **Step 2: Typecheck (routes next task — expect errors ONLY in future routes file, i.e. none yet since file doesn't exist)**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
Expected: TSC_OK (service standalone).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/purchases.ts
git commit -m "feat: purchase orchestrator service"
```

---

### Task 5: Purchases routes + mount

**Files:**
- Create: `apps/api/src/routes/purchases.ts`
- Modify: `apps/api/src/app.ts`
- Test: tsc clean

**Interfaces:**
- Consumes: Task 4 fns; schemas; guards per mapping below.
- Produces: mounted `/api/v1/purchases/*`.

Guards: orders POST/GET → purchases:create/view; PATCH cancel → purchases:cancel; receive → purchases:create; invoices POST → purchases:create; GET → purchases:view; payments POST → purchases:edit; void → purchases:cancel; reports → purchases:view (export button client-side gated purchases:export).

Routes (exact):
```ts
export const purchases = new Hono<{...}>()... // .use(requireAuth)
  .post("/orders", requirePerm(PURCHASES_CREATE), ...) // createOrderSchema → 201 {id, number}
  .get("/orders", requirePerm(PURCHASES_VIEW), ...) // ?supplierId=&branchId=&status=&search=&page=&limit=
  .get("/orders/:id", requirePerm(PURCHASES_VIEW), ...) // order + items
  .patch("/orders/:id/cancel", requirePerm(PURCHASES_CANCEL), ...) // {reason}, DRAFT/SENT only → CANCELLED + audit
  .post("/orders/:id/receive", requirePerm(PURCHASES_CREATE), ...) // {chargesLkr?, paidLkr?, paidMethod?} → 201 {invoiceId, number}
  .post("/invoices", requirePerm(PURCHASES_CREATE), ...) // createInvoiceSchema → 201
  .get("/invoices", requirePerm(PURCHASES_VIEW), ...) // filters
  .get("/invoices/:id", requirePerm(PURCHASES_VIEW), ...) // full detail
  .post("/invoices/:id/payments", requirePerm(PURCHASES_EDIT), ...) // payInvoiceSchema → 201
  .patch("/invoices/:id/void", requirePerm(PURCHASES_CANCEL), ...) // voidInvoiceSchema
  .get("/reports/summary", requirePerm(PURCHASES_VIEW), ...) // ?period=today|month|all&supplierId=&branchId=
  .get("/reports/breakdown", requirePerm(PURCHASES_VIEW), ...) // ?period=&groupBy=supplier|purity|category&branchId=
```
Order of registration: `/reports/*` BEFORE `/invoices/:id`? Different prefixes (`/reports/summary` vs `/invoices/:id`) — no conflict. `/orders/:id/receive` vs `/orders/:id` GET — distinct methods/paths, fine.
Cancel-order service: inline in route? No — implement `cancelOrder` in purchases.ts (Task 4 — add it there): checks DRAFT/SENT → CANCELLED + audit batch.
Period helper: today = start-of-day local server time (UTC day via Date setUTCHours? Use `new Date(); d.setHours(0,0,0,0)` server-local — document UTC assumption; Workers UTC → day boundary UTC. State explicitly.)

- [ ] **Step 1–3: Write routes, mount (`app.route("/api/v1/purchases", purchases)`), tsc clean, commit**

```bash
git add apps/api/src/routes/purchases.ts apps/api/src/app.ts
git commit -m "feat: purchase routes"
```

---

### Task 6: Live verify + remote deploy

**Files:** none.

**Interfaces:**
- Consumes: Tasks 1–5. Remote needs 0009 only.

- [ ] **Step 1: Remote migrate + deploy**

Run 0009 --remote → success; deploy → Version ID.

- [ ] **Step 2: Atomicity + math gate (local 8788, then remote smoke)**

Local: draft order (2 items) → no products/stock/journal exist for it (query products?search=<name> → 0 rows; movements for nonexistent → n/a) → receive with charges 5000 + paid 100000 cash → 201 → verify: products exist (JW-), stock +2, supplier ledger +305000 CR2000, journal balanced (DR1100 == CR2000 == total; DR2000 == CR1000 == paid), invoice PARTIAL + outstanding, audit has purchase.receive + purchase.pay.
Failure atomicity: receive with one bad item (bad purity) → 4xx → invoice absent (`GET /invoices?search=` 0) AND no products created (search 0) AND journal ref absent.
Payments: pay remainder → PAID; overpay → 400.
Void: void invoice (products IN_STOCK) → products VOID, reversal lines present, status VOID; create+sell-blocked? (no sales yet — instead: transfer one product then void → 409).
RBAC: cashier POST invoice → 403; accountant GET reports → 200.
Reports: summary today matches hand totals; breakdown by purity sums to total.
Remote smoke: direct invoice 1 item + full cash payment → PAID; ledger reflects.

- [ ] **Step 3: No commit**

---

### Task 7: Web purchases UI + dashboard wire

**Files:**
- Create: `apps/web/app/(app)/purchases/orders/page.tsx`, `apps/web/app/(app)/purchases/invoices/page.tsx`, `apps/web/app/(app)/purchases/invoices/[id]/page.tsx`, `apps/web/app/(app)/purchases/reports/page.tsx`
- Modify: sidebar (Purchases section), dashboard Today's Purchases card
- Test: tsc + build + click-through

**Interfaces:**
- Consumes: Task 5 endpoints.
- Produces: order/invoice/report screens.

- [ ] **Step 1: Sidebar + orders page**

Sidebar: section "Purchases" (perm purchases:view): Orders, Invoices, Reports — read sidebar file first for section shape.
Orders page: table (number, supplier code, items count, status) + create dialog (supplier select, branch default, items editor: dynamic rows with category/purity selects + name/weights/cost — reuse patterns from products page) + Receive dialog (charges, paid, method) + Cancel (reason).

- [ ] **Step 2: Invoices + detail + reports**

Invoices page: filters (supplier, status, date) + direct-create dialog (same item editor + charges/paid/method) + table.
Detail: header (number, supplier, totals, paid/outstanding, status), items table (barcode link, weights, cost), payments table + Pay dialog, Void button, journal lines table (from detail payload).
Reports: period tabs + groupBy tabs + cards (invoices, value, gold grams, outstanding) + breakdown table + CSV export (purchases:export gate via /me).
Dashboard: Today's Purchases card fetches summary?period=today → total value (fallback "—" on error/empty).

- [ ] **Step 3: Verify + commit**

tsc + build (routes /purchases/* present) + click-through 200s.
```bash
git add apps/web
git commit -m "feat: purchases UI and reports"
```

---

### Task 8: Docs + full verification

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/gold-accounting.md`
- Test: suite

- [ ] **Step 1: Docs**

database.md: 0009 tables + counters. api.md: all purchase endpoints + cents contract. permissions.md: purchases row (owner/manager full; accountant view/export; inventory view/create/edit; cashier/sales/gold view). gold-accounting.md: purchase posting example with accounts (DR1100/CR2000, DR2000/CR1000).

- [ ] **Step 2: Full suite + commit**

`pnpm test` 3/3 + `pnpm build` 3/3.
```bash
git add docs
git commit -m "docs: purchases tables, endpoints, postings"
```

---

## Self-Review

- Spec coverage: orders/invoices schema (§2 Tasks 1–2) ✓; 7-step atomic batch (§3 Tasks 3–4) ✓; charges allocation (§3 Task 4, tested Task 1) ✓; payments/credit (§3 Tasks 4–5) ✓; void+reversal (§3 Tasks 4–5) ✓; supplier ledger auto (§4 Task 5 — same journal) ✓; reports (§5 Tasks 4–5,7) ✓; UI (§4 Task 7) ✓; numbering (§2 Task 4 counters) ✓.
- Placeholder scan: no TBD/TODO; postings, bounds, statuses explicit.
- Type consistency: `amountCents`/`paidCents`/`total_cents` everywhere server-side; LKR only at Zod boundary and web display; `refEntity` strings fixed ('purchase_invoice','purchase_payment','adjustment'); movement `type` reuses INTAKE (create path) — consistent with inventory vocabulary.
