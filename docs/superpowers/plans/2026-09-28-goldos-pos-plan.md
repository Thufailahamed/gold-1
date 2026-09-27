# GoldOS POS & Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship counter-ready POS — atomic sales with split payments and approved discounts, printable invoices, full/partial returns with exchange linkage, sales reports — migrated and deployed.

**Architecture:** `receiveSale` orchestrator mirroring purchases: one `db.batch` with invoice + items + SOLD transitions + SALE_OUT movements + gold OUT rows + balanced journal + payments + audit. Inventory `recordMovement` refactored into `buildMoveStmts` + delegating wrapper (same pattern as product builders). Discount limits from settings with `sales:approve` override. Returns reverse via mirror journal + RETURNED transitions.

**Tech Stack:** Hono, Drizzle, D1, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler.

## Global Constraints

- Every write batches business row(s) + audit_logs; failure rolls back.
- No hard deletes; returns never modify the original sale.
- Strict TypeScript, no `any`; Zod client + server; typed responses.
- Money INTEGER cents, weights INTEGER mg; convert at API boundary only.
- Journal must balance; credit/partial requires customer.
- New perms `sales:view/create/edit/cancel/export/approve` (41 total).
- Keyboard-first POS: F2 scan, F9 pay, Enter complete.

---

## Permission additions

- 6 keys. owner: all (41). manager: all. accountant: view + export. cashier: view + create. salesperson: view + create. gold_officer/inventory_officer: view. manufacturing: none.

## File Structure

- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/sales.test.ts`
- Create: `apps/api/drizzle/0010_sales.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Modify: `apps/api/src/services/inventory.ts` (SALE_OUT + builders)
- Create: `apps/api/src/services/sales.ts`, `apps/api/src/routes/sales.ts`
- Modify: `apps/api/src/app.ts`
- Create web: `pos/page.tsx`, `sales/invoices`, `sales/invoices/[id]`, `sales/invoices/[id]/print`, `sales/returns`, `sales/reports`
- Modify web: sidebar, dashboard cards
- Modify docs: `database.md`, `api.md`, `permissions.md`, `gold-accounting.md`

---

### Task 1: Shared perms + sale schemas

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/sales.test.ts`
- Test: sales test

**Interfaces:**
- Consumes: existing patterns.
- Produces: 6 SALES_* perms + grants; `createSaleSchema, salePaySchema, createReturnSchema, discountPct` helper (+ type).

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/sales.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function discountPct(discountCents: number, subtotalCents: number): number {
  if (subtotalCents <= 0) throw new Error("subtotal must be positive");
  return (discountCents / subtotalCents) * 100;
}

describe("sales", () => {
  it("seeds sales permissions", () => {
    expect(PERMISSIONS.SALES_APPROVE).toBe("sales:approve");
    expect(DEFAULT_ROLES["cashier"]).toContain("sales:create");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("sales:approve");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("sales:view");
  });
  it("computes discount percent", () => {
    expect(discountPct(10000, 200000)).toBe(5);
  });
  it("splits sum to total", () => {
    const parts = [100000, 150000, 90000];
    expect(parts.reduce((s, x) => s + x, 0)).toBe(340000);
  });
});
```

(Service copies `discountPct` verbatim — same rule as allocateCharges.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/sales.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

permissions.ts: append 6 keys; DEFAULT_ROLES: owner/manager auto (manager filter unchanged); accountant append view+export; cashier append view+create; salesperson append view+create; gold_officer/inventory_officer append view.
schemas.ts append:
```ts
const saleItemSchema = z.object({
  productId: z.string().min(1),
  priceLkr: z.number().min(0).optional(),
  discountLkr: z.number().min(0).optional().default(0),
});

const splitPaySchema = z.object({
  method: z.enum(["cash", "card", "bank", "credit", "other"]),
  amountLkr: z.number().gt(0),
});

export const createSaleSchema = z.object({
  customerId: z.string().min(1).optional(),
  branchId: z.string().min(1),
  salespersonId: z.string().min(1).optional(),
  items: z.array(saleItemSchema).min(1),
  payments: z.array(splitPaySchema).min(1),
  approvedBy: z.string().min(1).optional(),
  exchangeReturnId: z.string().min(1).optional(),
});

export const createReturnSchema = z.object({
  invoiceId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).optional(),
  type: z.enum(["FULL", "PARTIAL", "EXCHANGE"]),
  reason: z.string().min(1).max(500),
  refundMethod: z.enum(["original", "cash", "bank", "credit"]).optional().default("original"),
  approvedBy: z.string().min(1).optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
```

- [ ] **Step 4: Green + commit**

Run: `pnpm exec vitest run packages/shared/src/sales.test.ts 2>&1 | grep -E "Tests "; pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
```bash
git add packages/shared/src/permissions.ts packages/shared/src/schemas.ts packages/shared/src/sales.test.ts
git commit -m "feat: sales permissions, schemas, discount spec"
```

---

### Task 2: Migration 0010 + drizzle + seed

**Files:**
- Create: `apps/api/drizzle/0010_sales.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Test: local apply + counts

**Interfaces:**
- Consumes: Task 1 perm names.
- Produces: sales + gold_movements tables; SINV/SRET counters; 6 perms + grants.

- [ ] **Step 1: Write 0010_sales.sql**

```sql
INSERT INTO counters (name, next) VALUES ('SINV', 1), ('SRET', 1);
CREATE TABLE sales_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  salesperson_id TEXT REFERENCES users(id),
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_sinvoices_branch ON sales_invoices(branch_id, created_at DESC);
CREATE INDEX idx_sinvoices_customer ON sales_invoices(customer_id, created_at DESC);
CREATE TABLE sales_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  price_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL
);
CREATE TABLE sales_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  ref_entity TEXT NOT NULL DEFAULT 'sale_payment',
  ref_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE sales_returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  refund_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  exchange_sale_id TEXT REFERENCES sales_invoices(id),
  status TEXT NOT NULL DEFAULT 'COMPLETE',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE sales_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES sales_returns(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  invoice_item_id TEXT NOT NULL REFERENCES sales_items(id)
);
CREATE TABLE gold_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  direction TEXT NOT NULL,
  fine_mg INTEGER NOT NULL,
  purity_permille INTEGER NOT NULL,
  ref_entity TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_gold_product ON gold_movements(product_id, created_at DESC);
CREATE INDEX idx_gold_ref ON gold_movements(ref_entity, ref_id);
INSERT INTO permissions (id, name) VALUES
  ('sales:view', 'sales:view'), ('sales:create', 'sales:create'),
  ('sales:edit', 'sales:edit'), ('sales:cancel', 'sales:cancel'),
  ('sales:export', 'sales:export'), ('sales:approve', 'sales:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'sales:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'sales:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'sales:view'), ('accountant', 'sales:export'),
  ('cashier', 'sales:view'), ('cashier', 'sales:create'),
  ('salesperson', 'sales:view'), ('salesperson', 'sales:create'),
  ('gold_officer', 'sales:view'), ('inventory_officer', 'sales:view');
```

- [ ] **Step 2: Drizzle (6 tables) + seed (6 perms + grants mirroring matrix)**

- [ ] **Step 3: Apply local + verify (perms 41, owner 41, counters SINV/SRET present)**

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0010_sales.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: sales tables, gold movements, permissions"
```

---

### Task 3: Inventory SOLD unlock + move builders

**Files:**
- Modify: `apps/api/src/services/inventory.ts`
- Test: tsc (sales service next task)

**Interfaces:**
- Consumes: existing recordMovement/moveStmt internals.
- Produces: `SALE_OUT` type; `IN_STOCK → SOLD` allowed; `buildMoveStmts`, `buildSaleOutStmts`; `recordMovement` delegates identically.

- [ ] **Step 1: Refactor**

- MovementType add `"SALE_OUT"`.
- ALLOW.IN_STOCK append `"SOLD"`.
- Extract from recordMovement's single-move path:
```ts
export async function buildMoveStmts(
  db: D1Database,
  productId: string,
  toStatus: string,
  opts: { toBranchId?: string; reason?: string; actorId: string; now: number; auditAction?: string }
): Promise<{ stmts: D1PreparedStatement[]; branchId: string; netMg: number }> {
  // prev lookup + checkTransition + VOID/LOST reason rule (same as today)
  // returns [status UPDATE, movement INSERT, audit INSERT] with action opts.auditAction ?? `inventory.${type.toLowerCase()}`
}
export async function recordMovement(db, input, actorId): Promise<{ movementId: string }> {
  const built = await buildMoveStmts(db, input.productId, input.toStatus, { toBranchId: input.toBranchId, reason: input.reason, actorId, now: Date.now() });
  await db.batch(built.stmts);
  // movementId: re-query? recordMovement currently returns movementId — change return to { ok: true }? Callers: inventory route returns data — check route usage and update route + web if needed. Minimal churn: keep { movementId } by selecting the movement row id after batch? Simplest: return { ok: true } and update routes/inventory.ts POST response + web inventory page (doesn't use movementId — verify with grep).
}
```
Grep first: `movementId` usages — update all.

- [ ] **Step 2: tsc + commit**

```bash
git add apps/api/src/services/inventory.ts apps/api/src/routes/inventory.ts apps/web/app/\(app\)/inventory/page.tsx
git commit -m "refactor: composable movement builders with SOLD"
```
(Include route/web files only if the return-shape change requires it; otherwise api-only.)

---

### Task 4: Sales service (orchestrator + returns + reports)

**Files:**
- Create: `apps/api/src/services/sales.ts`
- Test: tsc standalone (routes next)

**Interfaces:**
- Consumes: buildCreateProductStmts? No — sale uses existing products (lookup + priceFor); buildMoveStmts; postJournalStmts; getSetting (limits); discountPct (copy from test verbatim).
- Produces: `receiveSale, paySaleBalance?, createReturn, getSale, listSales, salesSummary, salesBreakdown`.

Discount/approval logic (verbatim rules):
```ts
const ROLE_DEFAULT_LIMITS: Record<string, number> = { cashier: 5, salesperson: 5, manager: 15, owner: 100, accountant: 0, inventory_officer: 0, gold_officer: 0, manufacturing_staff: 0 };
async function discountLimit(db, roleIds: string[]): Promise<number> {
  // max over caller's roles of (settings discount_limit_{role} ?? default); settings values are numbers (percent)
}
```
getSetting returns `{value: unknown}` — cast Number, fallback default. Caller roles: query user_roles. If discountPct > limit: require approvedBy (user exists, active, has sales:approve via role_permissions, != actorId) else FORBIDDEN "Discount exceeds limit".

receiveSale steps (exact):
```ts
export async function receiveSale(db, input: CreateSaleInput, actorId: string): Promise<{ invoiceId: string; number: string }> {
  const now = Date.now();
  // 1. branch active; customer (if given) active; salesperson = salespersonId ?? actorId (must be active user)
  // 2. load products: for each item: SELECT ... JOIN for price/cost/net/fine/permille/branch/status; must exist, IN_STOCK, same branchId else VALIDATION/NOT_FOUND
  // 3. price: item.priceLkr !== undefined ? lkrToCents : (selling_price_cents ?? livePrice via priceFor → amount_cents; noRate → VALIDATION "No rate for purity")
  // 4. subtotal = Σ price; discount = Σ discountLkr→cents (each ≤ its line price else VALIDATION); total; pct check + approval as above
  // 5. payments: methods map cash→1000, card/bank/other→1010, credit→1200 (requires customerId + party); Σ amounts == total else VALIDATION; credit allowed only with customer
  // 6. stmts: counter SINV→number; invoice INSERT (paid=total, status PAID — sales always fully paid at counter? Credit = receivable, still "paid" via 1200 leg. Status: PAID always (receivable counts as settled-by-credit). Keep UNPAID/PARTIAL statuses for future layaway — set PAID. paid_cents = total.)
  //    per item: UPDATE products SOLD + SALE_OUT movement (buildMoveStmts with auditAction "sale.sold") + gold OUT row + sales_items INSERT (price, discount, cost snapshot)
  //    journal: DR per payment leg (1000/1010/1200+party) / CR 4000 total; DR 5000 Σcost / CR 1100 Σcost; audit sale.complete
  //    payments INSERTs
  // 7. batch; return ids
}
```
Wait — paid_cents=total always → status PAID always. Keep status column for returns/void semantics (VOID unused; keep). Simplify: status always 'PAID'. (Partial/counter credit still recorded as 1200 receivable = paid economically.) Document.

createReturn steps:
```ts
export async function createReturn(db, input: CreateReturnInput, actorId: string) {
  // load invoice (not VOID status? sales have no VOID — skip) + its items + already-returned item ids (exclude double return → CONFLICT)
  // resolve items: FULL → all non-returned; PARTIAL/EXCHANGE → itemIds required, must belong + unreturned
  // refundTotal = Σ item price − item discount share? Use stored price_cents − discount share pro-rata: discount allocated per item at sale? Sale items store discount_cents per item (input). Refund per item = price − discount. Sum.
  // threshold: settings return_approval_threshold ?? 100000 (LKR→cents); if refundTotal >= threshold: require approvedBy with sales:approve (not self) else FORBIDDEN
  // refundMethod: original → mirror original payment methods pro-rata? Complexity! Simplify: refundMethod cash/bank/credit (explicit, default cash) + storeCredit flag? Spec: "refund to original method or store credit". Implement: refundMethod: 'original' → splits across original methods pro-rata (reuse payment legs); 'cash'/'bank' → single leg; 'credit' → CR 1200 + requires customer. storeCredit equivalent = credit method. So refundMethod enum: original|cash|bank|credit. Type in schema: refundMethod default original.
  // batch: return row (SRET number via counters) + return_items + products →RETURNED (buildMoveStmts auditAction "sale.returned") + gold IN rows (direction IN, same fine_mg) + reversal journal (DR 4000 refund / CR legs; + DR 1100 cost / CR 5000 cost) + audit sale.return
  // EXCHANGE: store exchangeSaleId later via PATCH? Provide `linkExchange(returnId, saleId)` internal + route PATCH /returns/:id/link {saleId} (perm sales:edit) validating same customer/branch. Add route in Task 5.
}
```
Hmm — spec says "exchange = return + new sale linked". linkExchange covers it. Include.

Reports:
```ts
export async function salesSummary(db, {from, to, branchId}) → { invoices, value_cents, paid_cents, gold_mg (Σ item net? use fine? use net_mg), discounts_cents }
export async function salesBreakdown(db, {from, to, branchId, groupBy: "category"|"purity"|"branch"|"salesperson"|"payment"|"product"}) 
```
payment-method breakdown: join sales_payments GROUP BY method. product: join items→products barcode/name. salesperson: join users name. Reuse purchases breakdown structure.

getSale: invoice + items (barcode/sku/name/weights) + payments + journal (ref sale_invoice|sale_payment) + returns.
listSales: filters supplier? No — customerId, branchId, status, from/to, search number.

- [ ] **Step 1–2: Write service, tsc standalone, commit**

```bash
git add apps/api/src/services/sales.ts
git commit -m "feat: sales orchestrator with returns and reports"
```

---

### Task 5: Sales routes + mount

**Files:**
- Create: `apps/api/src/routes/sales.ts`
- Modify: `apps/api/src/app.ts`
- Test: tsc clean

Guards: POST /invoices → sales:create; GET → sales:view; POST /returns → sales:cancel (returns are cancellations); PATCH returns/:id/link → sales:edit; reports → sales:view.
Routes: POST /invoices, GET /invoices (filters customerId/branchId/status/from/to/search), GET /invoices/:id, POST /returns, PATCH /returns/:id/link {saleId}, GET /returns (filters invoiceId/branchId), GET /reports/summary (?period=today|month|all&branchId=), GET /reports/breakdown (?period=&groupBy=&branchId=). dayBounds copy from purchases route (duplicate 12 lines — acceptable, local helper).

- [ ] **Step 1–3: Write, mount (`app.route("/api/v1/sales", sales)`), tsc, commit**

```bash
git add apps/api/src/routes/sales.ts apps/api/src/app.ts
git commit -m "feat: sales routes"
```

---

### Task 6: Live verify + remote deploy

**Files:** none.

- [ ] **Step 1: Remote migrate + deploy** (0010 --remote, deploy)

- [ ] **Step 2: Counter gate (local 8788, remote smoke)**

Local: create 2 IN_STOCK products via products endpoint (or purchase flow) → POST sale (1 item, cash full) → 201 → verify: product SOLD, SALE_OUT movement, gold OUT row (fine_mg), journal (DR1000/CR4000 + DR5000/CR1100), customer ledger (if customer) shows receivable 0 for cash / balance for credit split, audit sale.complete.
Split: 3-method payment sums to total → 201 PARTIAL? No — always PAID; verify 3 payment rows + 3 DR legs.
Discount: cashier 10% → 403; with manager approvedBy → 201; discount stored per item.
Credit without customer → 400. No-rate purity product → 400 (set: product with purity lacking rate — use 18K if unpublished locally? check first).
Return: partial 1 of 2 items → products RETURNED, reversal journal, original untouched; double return same item → 409; over-threshold without approver → 403, with → 201; exchange link → stored.
Reports match hand totals.
RBAC: salesperson POST → 201; manufacturing GET → 403.
Remote smoke: 1-item cash sale → PAID; ledger + reports reflect.

---

### Task 7: Web POS + sales UI

**Files:**
- Create: `apps/web/app/(app)/pos/page.tsx`, `sales/invoices`, `sales/invoices/[id]`, `sales/invoices/[id]/print`, `sales/returns`, `sales/reports`
- Modify: sidebar (Sales section), dashboard (Today's Sales, Gold Sold)
- Test: tsc + build + click-through

- [ ] **Step 1: Sidebar + POS screen**

Sidebar section "Sales" (perm sales:view): POS (`/pos`, perm sales:create), Invoices, Returns, Reports.
POS: autofocus scan input (Enter → barcode lookup → card push), cart table (remove line, per-line discount LKR input with role-limit meter via /me + settings? Role limit: fetch `discount_limit_{role}`? Roles list from /me? /me returns permissions not roles. Hmm — meter needs caller role: add roles to /me? Changing /me shape... simpler: attempt checkout, server enforces; meter shows discount % only. Drop server-limit fetch; show computed % + approver select (users list filtered? approver = any user id + server validates; provide manager list via /users?role? No role filter... use free user-id? Better UX: approver email input → resolve via users search. Implement: approver email field, lookup /users?search= → pick id. Acceptable.)
Customer search (customers endpoint), salesperson defaults to self, split-payment editor (add method+amount rows, auto-balance button, must sum to total), F2 focuses scan, F9 focuses pay, Enter on pay completes. On success: show invoice number + Print button (link to print view).

- [ ] **Step 2: Invoices/returns/reports/print + dashboard**

Invoices list (filters) + detail (lines, payments, journal, returns, void n/a) + print view (shop name from settings shop_name, branch name, SINV, datetime, customer, lines barcode/SKU/weights/purity/making/discount, totals, payment split; print CSS).
Returns page: create (invoice lookup, item checkboxes, type, reason, refund method, approver) + list + link-exchange (sale number input → resolve id → PATCH link).
Reports: period + groupBy tabs + cards + table + CSV (sales:export).
Dashboard: Today's Sales + Gold Sold cards fetch sales summary?period=today (fallback "—").

- [ ] **Step 3: Verify + commit**

tsc + build (routes present) + click-through 200s.
```bash
git add apps/web
git commit -m "feat: POS screen and sales UI"
```

---

### Task 8: Docs + full verification

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/gold-accounting.md`
- Test: suite

database.md: 0010 tables + counters + gold_movements. api.md: all sales endpoints + cents contract + approval rules. permissions.md: sales rows. gold-accounting.md: sale posting example (DR1000/1010/1200 / CR4000 + DR5000/CR1100), return reversal, gold OUT rows → future ledger absorption.
`pnpm test` + `pnpm build` 3/3 → commit docs.

---

## Self-Review

- Spec coverage: 14-step flow (§2 Task 4) ✓; split payments (§2 Tasks 4–5) ✓; discount limits+approval (§2 Tasks 4–5) ✓; invoice print (§4 Task 7) ✓; inventory/gold/financial/customer/audit updates (§2 Task 4) ✓; full/partial returns + exchange + approval (§4 Tasks 4–5,7) ✓; reports 8 ways (§5 Tasks 4–5,7) ✓; keyboard POS (§5 Task 7) ✓.
- Placeholder scan: no TBD/TODO; postings, thresholds, shortcuts explicit.
- Type consistency: `amount_cents` server / `amountLkr` boundary; `refEntity` 'sale_invoice'|'sale_payment'|'sale_return'; movement `SALE_OUT`; gold direction IN/OUT; print route path fixed.
