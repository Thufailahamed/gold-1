# GoldOS Manufacturing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship staged manufacturing orders consuming refined lots with QC loop, costed JW- outputs, gold ledger integration, lineage, and UI — migrated and deployed.

**Architecture:** `services/manufacturing.ts` mirrors `services/melting.ts` stage-for-stage (create→materials→produce→qc→finish→void); finish composes `buildCreateProductStmts` + `postGoldStmts` + audit in one batch. Lot consumption enforced against allocated sums. Single ledger-posting point at finish.

**Tech Stack:** Hono, Drizzle, D1, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler.

## Global Constraints

- Every write batches business row(s) + audit_logs; failure rolls back.
- No hard deletes; void pre-produce only with reason; QC fail returns to produce.
- Strict TypeScript, no `any`; Zod client + server; typed `{ success, data, error }` responses.
- Money INTEGER cents, weights INTEGER mg, purity INTEGER permille; convert at API boundary only.
- MO numbers `MO-000001` via counters; lot split across orders supported, remaining enforced.
- Reconciliation allocated == outputs + loss enforced exactly, else VALIDATION.
- New perms `mfg:view/create/edit/approve` (53 total); manufacturing_staff gets view/create/edit.
- `reverse` action still unseeded.

---

## Permission additions (single source of truth)

- `mfg:view`, `mfg:create`, `mfg:edit`, `mfg:approve`.
- Owner grant count becomes 53; manager 51 (still excludes users:approve, branches:approve).

## File Structure

- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/mfg.test.ts`
- Create: `apps/api/drizzle/0014_manufacturing.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Create: `apps/api/src/services/manufacturing.ts`, `apps/api/src/routes/manufacturing.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/services/gold.ts` (lineage MO kind)
- Modify web: sidebar (Manufacturing section), dashboard card
- Create web: `manufacturing/orders`, `manufacturing/orders/[id]`, `manufacturing/reports`
- Modify docs: `database.md`, `api.md`, `permissions.md`, `gold-accounting.md`

---

### Task 1: Shared mfg perms + schemas + math spec

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/mfg.test.ts`
- Test: `packages/shared/src/mfg.test.ts`

**Interfaces:**
- Consumes: existing `z`, `PERMISSIONS`, `DEFAULT_ROLES`.
- Produces: 4 MFG_* perms + grants; `createMfgOrderSchema, addMfgMaterialsSchema, produceMfgSchema, qcMfgSchema, finishMfgSchema` (+ types); `mfgBalance` helper (copied verbatim into service).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/mfg.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function mfgBalance(allocatedMg: number, outputsMg: number, lossMg: number): boolean {
  return allocatedMg === outputsMg + lossMg;
}

describe("manufacturing", () => {
  it("seeds mfg permissions", () => {
    expect(PERMISSIONS.MFG_APPROVE).toBe("mfg:approve");
    expect(DEFAULT_ROLES["manufacturing_staff"]).toContain("mfg:create");
    expect(DEFAULT_ROLES["manufacturing_staff"]).toContain("mfg:edit");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("mfg:approve");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("mfg:view");
  });
  it("balances the spec example: 8000 in, 7500 out, 500 loss", () => {
    expect(mfgBalance(8000, 7500, 500)).toBe(true);
    expect(mfgBalance(8000, 7500, 400)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/mfg.test.ts`
Expected: FAIL (missing MFG_* exports; math tests pass as pure spec).

- [ ] **Step 3: Implement perms + schemas**

permissions.ts: append `MFG_VIEW: "mfg:view", MFG_CREATE: "mfg:create", MFG_EDIT: "mfg:edit", MFG_APPROVE: "mfg:approve",` to PERMISSIONS. DEFAULT_ROLES: owner `[...ALL]` auto; manager filter unchanged; manufacturing_staff `["products:view", "mfg:view", "mfg:create", "mfg:edit"]`; accountant append `"mfg:view"`; gold_officer append `"mfg:view"`; inventory_officer append `"mfg:view"`. Others unchanged.
schemas.ts append:
```ts
export const createMfgOrderSchema = z.object({
  type: z.enum(["CUSTOMER", "INTERNAL"]),
  customerId: z.string().min(1).optional(),
  branchId: z.string().min(1),
  design: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueAt: z.number().int().positive().optional(),
});

export const addMfgMaterialsSchema = z.object({
  lots: z.array(z.object({
    lotBatchId: z.string().min(1),
    lotNumber: z.string().min(1),
    fineMg: z.number().int().gt(0),
  })).min(1).max(20),
});

const mfgOutputSchema = z.object({
  categoryId: z.string().min(1),
  metalTypeId: z.string().min(1),
  purityId: z.string().min(1),
  name: z.string().min(1).max(100),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  location: z.string().max(100).optional(),
});

export const produceMfgSchema = z.object({
  outputs: z.array(mfgOutputSchema).min(1).max(20),
  labourLkr: z.number().min(0).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  stoneCostLkr: z.number().min(0).optional().default(0),
  lossMg: z.number().int().min(0).optional().default(0),
  lossReason: z.string().max(500).optional(),
  approvedBy: z.string().min(1).optional(),
});

export const qcMfgSchema = z.object({
  pass: z.boolean(),
  reason: z.string().max(500).optional(),
});

export type CreateMfgOrderInput = z.infer<typeof createMfgOrderSchema>;
export type ProduceMfgInput = z.infer<typeof produceMfgSchema>;
```

- [ ] **Step 4: Green + typecheck + commit**

Run: `pnpm exec vitest run packages/shared/src/mfg.test.ts 2>&1 | grep -E "Tests "; pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
Expected: 2 passed + TSC_OK.
```bash
git add packages/shared/src/permissions.ts packages/shared/src/schemas.ts packages/shared/src/mfg.test.ts
git commit -m "feat: mfg permissions, schemas, balance spec"
```

---

### Task 2: Migration 0014 + drizzle + seed

**Files:**
- Create: `apps/api/drizzle/0014_manufacturing.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Test: local apply + counts + tsc

**Interfaces:**
- Consumes: Task 1 perm names.
- Produces: MO counter, 3 tables, 4 perms + grants.

- [ ] **Step 1: Write 0014_manufacturing.sql**

```sql
INSERT INTO counters (name, next) VALUES ('MO', 1);
CREATE TABLE manufacturing_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  design TEXT NOT NULL,
  description TEXT,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  labour_cents INTEGER NOT NULL DEFAULT 0,
  making_cents INTEGER NOT NULL DEFAULT 0,
  stone_cost_cents INTEGER NOT NULL DEFAULT 0,
  loss_mg INTEGER NOT NULL DEFAULT 0,
  loss_reason TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE manufacturing_materials (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES manufacturing_orders(id),
  lot_batch_id TEXT NOT NULL REFERENCES melting_batches(id),
  lot_number TEXT NOT NULL,
  fine_mg INTEGER NOT NULL
);
CREATE INDEX idx_mfgmat_lot ON manufacturing_materials(lot_batch_id, lot_number);
CREATE TABLE manufacturing_outputs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES manufacturing_orders(id),
  product_id TEXT NOT NULL UNIQUE REFERENCES products(id),
  gross_mg INTEGER NOT NULL,
  stone_mg INTEGER NOT NULL DEFAULT 0,
  net_mg INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL
);
INSERT INTO permissions (id, name) VALUES
  ('mfg:view', 'mfg:view'), ('mfg:create', 'mfg:create'),
  ('mfg:edit', 'mfg:edit'), ('mfg:approve', 'mfg:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'mfg:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'mfg:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'mfg:view'),
  ('gold_officer', 'mfg:view'),
  ('inventory_officer', 'mfg:view'),
  ('manufacturing_staff', 'mfg:view'),
  ('manufacturing_staff', 'mfg:create'),
  ('manufacturing_staff', 'mfg:edit');
```

- [ ] **Step 2: Drizzle (3 tables mirroring SQL) + seed.ts**

seed.ts: SEED_PERMISSIONS append 4; owner spread auto; manager filter auto; accountant/gold_officer/inventory_officer append mfg:view; manufacturing_staff `["products:view", "mfg:view", "mfg:create", "mfg:edit"]`.

- [ ] **Step 3: Apply local + verify**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0014_manufacturing.sql 2>&1 | grep -E "success|ERROR" | head -2`
Run: `... --command "SELECT COUNT(*) AS perms FROM permissions; SELECT COUNT(*) AS g FROM role_permissions WHERE role_id='owner';"` → perms 53, owner 53.
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK` (services untouched — passes).

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0014_manufacturing.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: manufacturing tables, MO counter, permissions"
```

---

### Task 3: Manufacturing service

**Files:**
- Create: `apps/api/src/services/manufacturing.ts`
- Test: tsc standalone (routes next task)

**Interfaces:**
- Consumes: `buildCreateProductStmts` from `./products`; `postGoldStmts` from `./gold`; `currentGoldRatesCents` from `./rates`; `getSetting`; `lkrToCents/gToMg/fineGoldMg` from shared; input types.
- Produces: `createOrder, addMaterials, produce, qcCheck, finishOrder, voidOrder, getOrder, listOrders, mfgSummary, wipList` — routes consume in Task 4.

- [ ] **Step 1: Write services/manufacturing.ts**

```ts
import { fineGoldMg, gToMg, lkrToCents, type CreateMfgOrderInput, type ProduceMfgInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { postGoldStmts } from "./gold";
import { buildCreateProductStmts } from "./products";
import { currentGoldRatesCents } from "./rates";
import { getSetting } from "./settings";

async function nextMO(db: D1Database, stmts: D1PreparedStatement[]): Promise<string> {
  const row = await db.prepare("SELECT next FROM counters WHERE name = 'MO'").bind().first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'MO'").bind(row.next + 1));
  return `MO-${String(row.next).padStart(6, "0")}`;
}

async function requireMfgApprover(db: D1Database, approverId: string, actorId: string): Promise<void> {
  // copy requireGoldApprover from melting.ts lines 17–33 verbatim, swapping "gold:manage" → "mfg:approve"
}

type OrderRow = { id: string; number: string; type: string; customer_id: string | null; branch_id: string; design: string; status: string; labour_cents: number; making_cents: number; stone_cost_cents: number; loss_mg: number };

async function loadOrder(db: D1Database, id: string): Promise<OrderRow> {
  const row = await db.prepare("SELECT * FROM manufacturing_orders WHERE id = ?").bind(id).first<OrderRow>();
  if (!row) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  return row;
}

async function allocatedFine(db: D1Database, orderId: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(fine_mg), 0) AS t FROM manufacturing_materials WHERE order_id = ?").bind(orderId).first<{ t: number }>();
  return row?.t ?? 0;
}

export async function createOrder(db: D1Database, input: CreateMfgOrderInput, actorId: string) {
  // CUSTOMER requires customerId (active) else VALIDATION; branch active check; batch [counter, INSERT DRAFT, audit mfg.create]; return { id, number }
}

export async function addMaterials(db: D1Database, orderId: string, lots: { lotBatchId: string; lotNumber: string; fineMg: number }[], actorId: string) {
  // order DRAFT else CONFLICT; for each: lot exists (melting_outputs JOIN melting_batches APPROVED) else NOT_FOUND; fineMg > 0; remaining = lot.fine_mg − allocated(lot across non-VOID orders) ; requested ≤ remaining else CONFLICT "Lot short: {remaining}mg available"; branch match (lot batch branch == order branch) else VALIDATION
  // batch [INSERT materials, UPDATE order →ALLOCATED, audit mfg.materials]; return { allocatedFineMg }
}

export async function produce(db: D1Database, orderId: string, input: ProduceMfgInput, actorId: string) {
  // order ALLOCATED or QC_FAILED else CONFLICT; validate each output refs (category/metal/purity active via checkRef copy? products builder validates refs itself at finish — but fail fast here: reuse buildCreateProductStmts? No — produce only STORES the spec, finish builds products. Validate refs now with inline SELECTs (copy checkRef 6-liner from products.ts).
  // output netMg = gToMg(grossG) − gToMg(stoneG) must be > 0 else VALIDATION
  // allocated = allocatedFine(); outFine = Σ netMg... wait outputs carry no purity — net weight vs fine? Outputs need purity for fine gold. mfgOutputSchema HAS purityId — fine per output = fineGoldMg(netMg, permille lookup). loss check: allocated == Σ outputFine + lossMg else VALIDATION "Out of balance"
  // loss% = lossMg/allocated*100 vs settings mfg_loss_approve_pct (default 3) → over needs input.approvedBy with mfg:approve (not self) else FORBIDDEN
  // loss reason: lossMg > 0 requires lossReason else VALIDATION
  // batch [INSERT manufacturing_outputs rows WITHOUT product_id? Schema says product_id NOT NULL... produce stores spec but products created at finish. Conflict! Fix: manufacturing_outputs.product_id NULLABLE — but Task 2 already wrote NOT NULL. Resolve: produce stores spec in a separate staging approach — simplest: manufacturing_outputs.product_id nullable. AMEND Task 2 SQL+schema now (before apply): product_id TEXT REFERENCES products(id) (nullable). Do it in this task's first edit — migration unapplied so safe.
  // store: INSERT outputs (product_id NULL, specs gross/stone/net/cost placeholder 0), UPDATE order (labour/making/stone/loss/loss_reason, status IN_PRODUCTION), audit mfg.produce; return { outputFineMg, lossPct }
}
```

Hmm — outputs table also needs purity/category/etc. spec columns if product created later. Add to Task 2 schema: `manufacturing_outputs` gets `category_id, metal_type_id, purity_id, name, location NULL, making_cents DEFAULT 0` columns. AMEND Task 2 now (migration not yet applied — safe): rewrite the CREATE TABLE in 0014 + drizzle + regenerate. Do these amendments as Step 0 of this task before writing the service. Also `cost_cents` filled at finish (UPDATE). And `net_mg`/`gross_mg`/`stone_mg` already there. Add `making_cents INTEGER DEFAULT 0`.

```ts
export async function qcCheck(db: D1Database, orderId: string, pass: boolean, reason: string | undefined, actorId: string) {
  // IN_PRODUCTION only else CONFLICT; fail requires reason else VALIDATION; →QC_PASSED / QC_FAILED + audit mfg.qc
}

export async function finishOrder(db: D1Database, orderId: string, actorId: string) {
  // QC_PASSED only else CONFLICT
  // board rate: currentGoldRatesCents → map purity→rate; cost share: goldValue = Σ outputFine × rate(purity)/1000... per-output purity differs — compute per output: goldCents_i = round(fine_i × rate_i / 1000); totalGold = Σ; totalCost = totalGold + labour + making + stones; share by output fine weight (remainder to first, allocateCharges-style inline)
  // per output: buildCreateProductStmts(db, {name, categoryId, metalTypeId, purityId, grossG: gross_mg/1000, stoneG: stone_mg/1000, makingLkr: making share? making is order-level → fold into costLkr share, pass makingLkr: 0? Product making_charge display... put per-output making = 0 and fold all into cost. Simpler + honest: makingLkr 0, cost includes everything.}, actorId, branch, now) → stmts + UPDATE manufacturing_outputs SET product_id, cost_cents + gold MANUFACTURING_OUTPUT entries (source manufacturing:{orderId}, destination branch:{branch}, weight net, permille, productId) + MANUFACTURING_INPUT entries per lot (source melting lot, destination manufacturing:{orderId}, weightMg = allocated lot net? lots store fine only... inputs need weightMg + permille: lot weight_mg + permille from melting_outputs row) + UPDATE order COMPLETE + audit mfg.finish
  // batch all; return { productIds, barcodes }
}

export async function voidOrder(db: D1Database, orderId: string, reason: string, actorId: string) {
  // DRAFT only else CONFLICT (materials exist only from ALLOCATED — DRAFT void has no allocations; if ALLOCATED+ → CONFLICT "release materials first"? No release endpoint... decide: VOID allowed in DRAFT or ALLOCATED (deletes material rows = releases lots) else CONFLICT. Implement that.
}

export async function getOrder(db: D1Database, id: string) {
  // order + materials (join lot numbers) + outputs (+ product barcode when finished) + gold_ledger rows (ref manufacturing_order) — return { order, materials, outputs, ledger }
}

export async function listOrders(db: D1Database, userId: string, canManageAll: boolean, opts: PageOpts & { status?: string; type?: string; branchId?: string; customerId?: string }) {
  // LIKE number/design + filters + branch scoping (same pattern as listSales); { rows, total } with customer name join
}

export async function mfgSummary(db: D1Database, opts: { from: number; to: number; branchId?: string }) {
  // counts by status, SUM allocated/output/loss fine, SUM labour+making+stones → { byStatus, goldInMg, goldOutMg, lossMg, labourCents }
}

export async function wipList(db: D1Database, branchId?: string) {
  // orders in ALLOCATED/IN_PRODUCTION/QC_* with allocated fine + outputs count
}
```

- [ ] **Step 2: Amend Task 2 outputs table FIRST (migration unapplied — safe), then write service, tsc, commit**

Amend 0014_manufacturing.sql manufacturing_outputs:
```sql
CREATE TABLE manufacturing_outputs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES manufacturing_orders(id),
  product_id TEXT REFERENCES products(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  metal_type_id TEXT NOT NULL REFERENCES metal_types(id),
  purity_id TEXT NOT NULL REFERENCES purities(id),
  name TEXT NOT NULL,
  gross_mg INTEGER NOT NULL,
  stone_mg INTEGER NOT NULL DEFAULT 0,
  net_mg INTEGER NOT NULL,
  making_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  location TEXT
);
```
Mirror in drizzle schema. (produce inserts spec with product_id NULL, cost 0; finish UPDATEs them.)
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
```bash
git add apps/api/src/services/manufacturing.ts apps/api/drizzle/0014_manufacturing.sql apps/api/src/db/schema.ts
git commit -m "feat: manufacturing order pipeline service"
```

---

### Task 4: Manufacturing routes + mount + lineage

**Files:**
- Create: `apps/api/src/routes/manufacturing.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/services/gold.ts` (MO lineage)
- Test: tsc clean

**Interfaces:**
- Consumes: Task 3 fns; schemas; guards below.
- Produces: mounted `/api/v1/manufacturing/*`; lineage handles manufacturing_order + refined_lot→order edges.

Guards: POST/PATCH → mfg:create / mfg:edit (produce/qc/finish/void = mfg:edit); GET → mfg:view. Routes:
```ts
.post("/orders", requirePerm(MFG_CREATE), ...) // createMfgOrderSchema → 201 { id, number }
.get("/orders", requirePerm(MFG_VIEW), ...) // filters status/type/branchId/customerId/search/page/limit
.get("/orders/:id", requirePerm(MFG_VIEW), ...)
.post("/orders/:id/materials", requirePerm(MFG_EDIT), ...) // addMfgMaterialsSchema → 201 { allocatedFineMg }
.post("/orders/:id/produce", requirePerm(MFG_EDIT), ...) // produceMfgSchema → 200 { outputFineMg, lossPct }
.post("/orders/:id/qc", requirePerm(MFG_EDIT), ...) // qcMfgSchema → 200
.post("/orders/:id/finish", requirePerm(MFG_EDIT), ...) // → 201 { productIds, barcodes }
.patch("/orders/:id/void", requirePerm(MFG_EDIT), ...) // { reason } → 200
.get("/reports/summary", requirePerm(MFG_VIEW), ...) // ?period=today|month|all&branchId= (dayBounds copy)
.get("/reports/wip", requirePerm(MFG_VIEW), ...) // ?branchId=
```
dayBounds: copy 12-line helper from sales route (same UTC-day semantics).
gold.ts lineage additions: in expand(), add `manufacturing_order` branch: materials (lot_batch_id+lot_number → melting_batch node + edge "consumes") and outputs (product_id → product nodes + edge "produced"); refined_lot branch: query manufacturing_materials JOIN melting_outputs... lot identity is (batch, lot_number) — find orders using it → manufacturing_order nodes + edge "consumed by". Seed labels/linkFor: manufacturing_order → `/manufacturing/orders/${id}`.

- [ ] **Step 1–3: gold.ts lineage edit, write routes, mount (`app.route("/api/v1/manufacturing", manufacturing);` alphabetical near melting), tsc clean, commit**

```bash
git add apps/api/src/routes/manufacturing.ts apps/api/src/app.ts apps/api/src/services/gold.ts
git commit -m "feat: manufacturing routes and lineage"
```

---

### Task 5: Live verify + remote deploy

**Files:** none.

- [ ] **Step 1: Remote migrate + deploy**

Run: `./scripts/cloudflare-sync.sh` (migrates 0014, deploys, health-checks).
If Cloudflare import API flakes (seen with 0009): retry once; if FK error: seed prerequisite rows first.

- [ ] **Step 2: Counter gate (local 8788 first, then remote smoke)**

Local (admin; port 8788): need approved refined lot — melt a batch first (reuse melting gate: intake OG → test → value → purchase → release → batch → melt → approve) OR check existing local lots. Then: create INTERNAL order → add lot material (over-allocate → 409) → produce (outputs + loss over 3% w/o approver → 403; with manager → 200) → QC fail (no reason → 400; with reason → QC_FAILED) → produce again → QC pass → finish → verify: JW- products IN_STOCK with cost>0, MANUFACTURING_INPUT/OUTPUT/LOSS gold rows, lineage lot→MO→products, audit mfg.* chain. Void: new order → void DRAFT → 200; void post-produce → 409. RBAC: cashier POST → 403; mfg staff (create one) full flow → 200. Reports hand-verified. `pnpm exec vitest run` green.
Remote smoke: order + finish 1 product → COMPLETE; ledger present. No commit.

---

### Task 6: Web manufacturing UI

**Files:**
- Modify: `apps/web/components/app-sidebar.tsx` (Manufacturing section), `apps/web/app/(app)/page.tsx` (Gold in manufacturing card)
- Create: `apps/web/app/(app)/manufacturing/orders/page.tsx`, `manufacturing/orders/[id]/page.tsx`, `manufacturing/reports/page.tsx`
- Test: tsc + build + click-through

- [ ] **Step 1: Sidebar + orders list/create**

Sidebar section "Manufacturing" (perm mfg:view): Orders, Reports — read sidebar file first for section shape.
orders/page.tsx: table (number, type, design, status, due) + filters (status/type) + create dialog (type toggle CUSTOMER/INTERNAL, customer search when CUSTOMER, design, description, due date, branch default).

- [ ] **Step 2: Order detail (stepper)**

orders/[id]/page.tsx: stage stepper (DRAFT→ALLOCATED→IN_PRODUCTION→QC→COMPLETE), materials scan-add (lot number input → resolve batch via melting detail? Lots have no lookup endpoint — resolve by listing batches? Add lot lookup: query melting batch by lot? Simplest: two fields batch number + lot number → service resolves batch id via number lookup... service needs batch id. Alternative: materials dialog lists APPROVED batches with their lots (GET /melting/batches?status=APPROVED → per batch outputs). Implement lot picker: select batch (approved only) → select lot → fine amount (default remaining — needs remaining endpoint? compute client-side? No remaining data... add `GET /melting/batches/:id` outputs include fine; allocated sums need new endpoint. DECISION (document in commit): materials form takes lotBatchId via batch picker showing lots with fine; remaining enforced server-side with 409 message showing available mg. Good enough for counter use.)
Produce form: dynamic output rows (category/metal/purity selects + name/weights/making/location) + labour/making/stones totals + loss + reason + approver + live reconciliation preview (allocated vs outputs+loss, must equal).
QC pass/fail dialog, finish button, void button, lineage chain embed (reuse LineageChain with refEntity=manufacturing_order), ledger rows table, outputs table with product links.

- [ ] **Step 3: Reports + dashboard + verify**

reports/page.tsx: period tabs + status counts + gold in/out/loss cards + labour card + WIP table.
page.tsx: "Gold in manufacturing" card → wip sum (fallback "—", existing pattern).
tsc + build (/manufacturing/* present) + click-through 200s (API 8788, web 3001).
```bash
git add apps/web
git commit -m "feat: manufacturing UI and reports"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/gold-accounting.md`
- Test: suite

database.md: 0014 section. api.md: all manufacturing endpoints + cents contract + approval rules. permissions.md: mfg rows. gold-accounting.md: manufacturing postings (INPUT/OUTPUT/LOSS at finish, cost basis = board rate at finish).
`pnpm test` + `pnpm build` 3/3 → commit docs.

---

## Self-Review

- Spec coverage: MO numbering (§2 Tasks 1–2) ✓; staged flow (§2 Tasks 3–4) ✓; lot allocation + remaining (§2 Tasks 3–4) ✓; QC loop (§2 Tasks 3–4,6) ✓; finished specs incl. SKU/barcode/weights/cost (§2 Tasks 3,6) ✓; reconciliation exact (§2 Tasks 1,3) ✓; lineage (§4 Tasks 4,6) ✓; ledgers updated (§2 Tasks 3–4) ✓; UI list/form/edit/detail/scan meaning/labels (§4 Task 6 — labels via existing product label route, no new label code) ✓.
- Placeholder scan: no TBD/TODO; postings, thresholds, cost basis explicit.
- Type consistency: `amount_cents` server / LKR boundary; `refEntity` 'manufacturing_order'; lot identity (batch_id + lot_number) used consistently in service/routes/UI copy.
