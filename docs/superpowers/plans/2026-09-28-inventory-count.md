# Stock Count (Session + Ledger Posting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the stock-count workflow — start, scan, compare, investigate, approve with full ledger posting — behind one open-count-per-scope lock.

**Architecture:** Pure `compareCount` in `packages/shared/src/accounting.ts`; migration `0022_stock_count.sql` with `stock_counts` + `count_scans`; service `apps/api/src/services/counts.ts` owning session/scan/compare/approve plus `assertCountLock` called from inventory and sales paths; routes `apps/api/src/routes/counts.ts` wired as `/api/v1/counts`. Approval reuses `postGoldStmts` and `buildEntryStmts` for the ledger legs but values the journal at the product's book `cost_cents`.

**Tech Stack:** Hono 4 on Cloudflare Workers, Drizzle ORM → D1 (SQLite), Zod 3 server validation, Vitest 2, TypeScript 5.5 strict (no `any`).

## Global Constraints

- Money in INTEGER cents exact; gold in INTEGER fine milligrams exact; 0 tolerance for mg.
- Every write batches the business change with its `audit_logs` row in one `db.batch`; append-only, never DELETE/UPDATE history; corrections are reversals.
- Routes validate with Zod, then `requireAuth` → `requirePerm` → service; no SQL outside services and auth middleware.
- Barcodes are never changed by any count operation.
- Compare derives only from the frozen snapshot + scan rows; an empty count returns zeros, never fabricated matches.
- Approval posts only still-missing lines with a reason and a second person; UNEXPECTED-only counts close with zero postings.
- Shop-wide listing requires `branches:manage`; otherwise `branchId` is required (same rule as the monthly report).

---

### Task 1: Shared compareCount pure helper

**Files:**
- Modify: `packages/shared/src/accounting.ts`
- Test: `packages/shared/src/accounting.test.ts`

**Interfaces:**
- Consumes: nothing new (standalone pure function).
- Produces: `compareCount(expected: { productId: string; barcode: string }[], scans: { barcode: string; productId: string | null }[]): { matched: string[]; missing: string[]; unexpected: string[]; duplicates: string[]; matchedCount: number }` (ids are productIds; UNEXPECTED scans with null productId appear in `unexpected` by barcode) — used by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
describe("compareCount", () => {
  it("splits matched, missing, unexpected and duplicates", () => {
    const r = compareCount(
      [{ productId: "p1", barcode: "JW-AAAAAA" }, { productId: "p2", barcode: "JW-BBBBBB" }],
      [{ barcode: "jw-aaaaaa", productId: "p1" }, { barcode: "JW-AAAAAA", productId: "p1" }, { barcode: "XX-000000", productId: null }]
    );
    expect(r.matched).toEqual(["p1"]);
    expect(r.missing).toEqual(["p2"]);
    expect(r.unexpected).toEqual(["XX-000000"]);
    expect(r.duplicates).toEqual(["p1"]);
    expect(r.matchedCount).toBe(1);
  });
  it("treats an empty count as fully unaccounted, not matched", () => {
    const r = compareCount([{ productId: "p1", barcode: "JW-AAAAAA" }], []);
    expect(r.matchedCount).toBe(0);
    expect(r.missing).toEqual(["p1"]);
  });
});
```

Matching rule: barcode compare is case-insensitive (`toUpperCase` both sides); a scan whose productId is in expected counts once as matched, further scans of it as duplicates; a scan whose productId is null or not in expected is unexpected.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @goldos/shared exec vitest run src/accounting.test.ts -t "compareCount"`
Expected: FAIL with "compareCount is not defined" (or not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
export function compareCount(
  expected: { productId: string; barcode: string }[],
  scans: { barcode: string; productId: string | null }[]
): { matched: string[]; missing: string[]; unexpected: string[]; duplicates: string[]; matchedCount: number } {
  const byBarcode = new Map(expected.map((e) => [e.barcode.toUpperCase(), e.productId]));
  const seen = new Set<string>();
  const matched: string[] = [];
  const duplicates: string[] = [];
  const unexpected: string[] = [];
  for (const s of scans) {
    const pid = s.productId ?? byBarcode.get(s.barcode.toUpperCase()) ?? null;
    if (!pid || !byBarcode.has(s.barcode.toUpperCase()) || (s.productId && ![...byBarcode.values()].includes(s.productId))) {
      if (!unexpected.includes(s.barcode.toUpperCase())) unexpected.push(s.barcode.toUpperCase());
      continue;
    }
    if (seen.has(pid)) {
      if (!duplicates.includes(pid)) duplicates.push(pid);
      continue;
    }
    seen.add(pid);
    matched.push(pid);
  }
  const missing = expected.map((e) => e.productId).filter((id) => !seen.has(id));
  return { matched, missing, unexpected, duplicates, matchedCount: matched.length };
}
```

Append after `goldClose` in `packages/shared/src/accounting.ts`. Simplify the unexpected branch while keeping behavior: a scan is unexpected when its resolved productId is null or not in the expected id set.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @goldos/shared exec vitest run src/accounting.test.ts -t "compareCount"`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/accounting.ts packages/shared/src/accounting.test.ts
git commit -m "feat: compareCount pure helper with tests"
```

### Task 2: Stock count migration + schema

**Files:**
- Create: `apps/api/drizzle/0022_stock_count.sql`
- Modify: `apps/api/src/db/schema.ts` (append at end)

**Interfaces:**
- Consumes: `branches(id)`, `products(id)`, `users(id)` FK targets (already exist).
- Produces: `stock_counts` + `count_scans` tables and `stockCounts` / `countScans` drizzle models used by Task 3.

- [ ] **Step 1: Write the migration file**

```sql
-- 0022_stock_count.sql
-- Count sessions with frozen snapshots and append-only scan logs.
CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  scope TEXT NOT NULL,
  scope_ref TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  expected_json TEXT NOT NULL,
  result_json TEXT,
  opened_by TEXT REFERENCES users(id),
  closed_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_sc_open_scope ON stock_counts(branch_id, scope, COALESCE(scope_ref, '')) WHERE status = 'OPEN';
CREATE INDEX idx_sc_status ON stock_counts(status);

CREATE TABLE count_scans (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES stock_counts(id),
  barcode TEXT NOT NULL,
  product_id TEXT REFERENCES products(id),
  flag TEXT NOT NULL DEFAULT 'OK',
  scanned_by TEXT REFERENCES users(id),
  scanned_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cs_count ON count_scans(count_id);
```

Save exactly as `apps/api/drizzle/0022_stock_count.sql`.

- [ ] **Step 2: Append drizzle schema**

```ts
export const stockCounts = sqliteTable("stock_counts", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull(),
  scope: text("scope").notNull(),
  scopeRef: text("scope_ref"),
  status: text("status").notNull().default("OPEN"),
  expectedJson: text("expected_json").notNull(),
  resultJson: text("result_json"),
  openedBy: text("opened_by"),
  closedBy: text("closed_by"),
  createdAt: integer("created_at").notNull(),
});

export const countScans = sqliteTable("count_scans", {
  id: text("id").primaryKey(),
  countId: text("count_id").notNull(),
  barcode: text("barcode").notNull(),
  productId: text("product_id"),
  flag: text("flag").notNull().default("OK"),
  scannedBy: text("scanned_by"),
  scannedAt: integer("scanned_at").notNull(),
  createdAt: integer("created_at").notNull(),
});
```

Append after `monthSnapshots` in `apps/api/src/db/schema.ts`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0022_stock_count.sql apps/api/src/db/schema.ts
git commit -m "feat: stock count session tables"
```

### Task 3: Counts service — start, scan, compare, notes, cancel, lock

**Files:**
- Create: `apps/api/src/services/counts.ts`

**Interfaces:**
- Consumes: `compareCount` from `@goldos/shared` (Task 1); `buildAuditStmt` from `../middleware/audit` (signature `buildAuditStmt(db, entry)`).
- Produces: `startCount`, `recordScan`, `compare`, `addNote`, `cancelCount`, `assertCountLock(db, productId)` — Task 4 (approve) and Task 5 (routes, lock wiring) consume these exact names.

- [ ] **Step 1: Write the service**

```ts
import { compareCount } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";

export type CountScope = "FULL" | "CATEGORY" | "BRANCH" | "LOCATION";

export async function assertCountLock(db: D1Database, productId: string): Promise<void> {
  const prod = await db.prepare("SELECT id, branch_id FROM products WHERE id = ?").bind(productId).first<{ id: string; branch_id: string }>();
  if (!prod) return;
  const { results } = await db.prepare(`SELECT id, expected_json AS json FROM stock_counts WHERE branch_id = ? AND status = 'OPEN'`).bind(prod.branch_id).all<{ id: string; json: string }>();
  for (const row of results ?? []) {
    const expected = JSON.parse(row.json) as { productId: string }[];
    if (expected.some((e) => e.productId === productId))
      throw Object.assign(new Error("Product is under an open stock count"), { code: "TRANSITION_LOCKED" });
  }
}

export async function startCount(db: D1Database, input: { branchId: string; scope: CountScope; scopeRef?: string }, actorId: string): Promise<{ id: string; expectedCount: number }> {
  if (!["FULL", "CATEGORY", "BRANCH", "LOCATION"].includes(input.scope))
    throw Object.assign(new Error("Invalid scope"), { code: "VALIDATION" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  let cond = "p.status = 'IN_STOCK' AND p.branch_id = ?";
  const vals: unknown[] = [input.branchId];
  if (input.scope === "CATEGORY") {
    const cat = await db.prepare("SELECT id FROM categories WHERE id = ?").bind(input.scopeRef).first();
    if (!cat) throw Object.assign(new Error("Category not found"), { code: "NOT_FOUND" });
    cond += " AND p.category_id = ?";
    vals.push(input.scopeRef);
  }
  if (input.scope === "LOCATION") {
    if (!input.scopeRef) throw Object.assign(new Error("location required"), { code: "VALIDATION" });
    cond += " AND p.location = ?";
    vals.push(input.scopeRef);
  }
  const { results } = await db.prepare(`SELECT p.id, p.barcode FROM products p WHERE ${cond}`).bind(...vals).all<{ id: string; barcode: string }>();
  const expected = (results ?? []).map((r) => ({ productId: r.id, barcode: r.barcode }));
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(`INSERT INTO stock_counts (id, branch_id, scope, scope_ref, status, expected_json, opened_by, created_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`).bind(id, input.branchId, input.scope, input.scopeRef ?? null, JSON.stringify(expected), actorId, now),
      buildAuditStmt(db, { userId: actorId, action: "count.start", entity: "stock_count", entityId: id, next: { scope: input.scope }, branchId: input.branchId }),
    ]);
  } catch (e) {
    throw Object.assign(new Error("An open count already exists for this scope"), { code: "CONFLICT" });
  }
  return { id, expectedCount: expected.length };
}

export async function recordScan(db: D1Database, countId: string, barcode: string, actorId: string): Promise<{ flag: string }> {
  const count = await db.prepare("SELECT id, status FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; status: string }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  if (count.status !== "OPEN") throw Object.assign(new Error("Count is closed"), { code: "CONFLICT" });
  const prod = await db.prepare("SELECT id FROM products WHERE UPPER(barcode) = UPPER(?)").bind(barcode).first<{ id: string }>();
  const prior = await db.prepare("SELECT id FROM count_scans WHERE count_id = ? AND UPPER(barcode) = UPPER(?)").bind(countId, barcode).first();
  const flag = prod ? (prior ? "DUPLICATE" : "OK") : "UNEXPECTED";
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO count_scans (id, count_id, barcode, product_id, flag, scanned_by, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), countId, barcode.toUpperCase(), prod?.id ?? null, flag, actorId, now, now),
    buildAuditStmt(db, { userId: actorId, action: "count.scan", entity: "stock_count", entityId: countId, next: { barcode: barcode.toUpperCase(), flag } }),
  ]);
  return { flag };
}

export async function compare(db: D1Database, countId: string) {
  const count = await db.prepare("SELECT expected_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ json: string }>();
  if (!count) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  const { results } = await db.prepare("SELECT barcode, product_id FROM count_scans WHERE count_id = ?").bind(countId).all<{ barcode: string; product_id: string | null }>();
  return compareCount(JSON.parse(count.json), (results ?? []).map((r) => ({ barcode: r.barcode, productId: r.product_id })));
}

export async function addNote(db: D1Database, countId: string, productId: string, note: string, actorId: string): Promise<void> {
  const count = await db.prepare("SELECT id, status, result_json AS json FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; status: string; json: string | null }>();
  if (!count || count.status !== "OPEN") throw Object.assign(new Error("Count not open"), { code: "CONFLICT" });
  const notes = count.json ? (JSON.parse(count.json).notes ?? {}) : {};
  notes[productId] = note;
  await db.batch([
    db.prepare("UPDATE stock_counts SET result_json = ? WHERE id = ?").bind(JSON.stringify({ notes }), countId),
    buildAuditStmt(db, { userId: actorId, action: "count.note", entity: "stock_count", entityId: countId, next: { productId }, reason: note }),
  ]);
}

export async function cancelCount(db: D1Database, countId: string, reason: string, actorId: string): Promise<void> {
  const cmp = await compare(db, countId);
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE stock_counts SET status = 'CANCELLED', result_json = ?, closed_by = ? WHERE id = ? AND status = 'OPEN'").bind(JSON.stringify(cmp), actorId, countId),
    buildAuditStmt(db, { userId: actorId, action: "count.cancel", entity: "stock_count", entityId: countId, reason }),
  ]);
}
```

Note on `startCount` conflict mapping: the `idx_sc_open_scope` partial unique index rejects a second OPEN count for the same scope — any batch failure there maps to 409 CONFLICT. Keep the try/catch as written.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/counts.ts
git commit -m "feat: stock count session scan compare lock"
```

### Task 4: Counts service — approve with ledger posting

**Files:**
- Modify: `apps/api/src/services/counts.ts`

**Interfaces:**
- Consumes: `compare` from Task 3 (same file); `postGoldStmts` from `./gold`; `buildEntryStmts` from `./journal`; `businessDateFor` from `./busdate`; `currentGoldRatesCents` from `./rates`.
- Produces: `approveCount(db, countId, { reason, approvedBy }, actorId): Promise<{ posted: number }>` consumed by Task 5.

- [ ] **Step 1: Append the approval function**

```ts
import { postGoldStmts } from "./gold";
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
import { currentGoldRatesCents } from "./rates";

export async function approveCount(db: D1Database, countId: string, input: { reason: string; approvedBy: string }, actorId: string): Promise<{ posted: number }> {
  if (!input.reason?.trim()) throw Object.assign(new Error("Reason required"), { code: "VALIDATION" });
  if (input.approvedBy === actorId) throw Object.assign(new Error("Approver cannot be yourself"), { code: "FORBIDDEN" });
  const approver = await db.prepare(
    `SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`
  ).bind(input.approvedBy).all<{ name: string }>();
  if (!(approver.results ?? []).some((r) => r.name === "gold:manage"))
    throw Object.assign(new Error("Approval requires gold:manage"), { code: "FORBIDDEN" });
  const count = await db.prepare("SELECT id, branch_id, status FROM stock_counts WHERE id = ?").bind(countId).first<{ id: string; branch_id: string; status: string }>();
  if (!count || count.status !== "OPEN") throw Object.assign(new Error("Count not open"), { code: "CONFLICT" });
  const cmp = await compare(db, countId);
  const rates = await currentGoldRatesCents(db);
  const now = Date.now();
  const entryDate = await businessDateFor(db, now);
  let posted = 0;
  for (const productId of cmp.missing) {
    const prod = await db.prepare("SELECT id, status, branch_id, net_mg, fine_gold_mg, cost_cents, purity_id FROM products WHERE id = ?").bind(productId).first<{ id: string; status: string; branch_id: string; net_mg: number; fine_gold_mg: number; cost_cents: number | null; purity_id: string }>();
    if (!prod || prod.status !== "IN_STOCK") continue;
    if (!prod.cost_cents || prod.cost_cents <= 0) throw Object.assign(new Error(`No book cost for ${productId}; cannot post adjustment`), { code: "VALIDATION" });
    if (!rates.some((r) => r.purity_id === prod.purity_id))
      throw Object.assign(new Error("No gold rate for this purity; cannot value the adjustment"), { code: "VALIDATION" });
    const purity = await db.prepare("SELECT permille FROM purities WHERE id = ?").bind(prod.purity_id).first<{ permille: number }>();
    if (!purity) throw Object.assign(new Error("Purity not found"), { code: "VALIDATION" });
    const moveId = crypto.randomUUID();
    const goldStmts = await postGoldStmts(db, [{ branchId: count.branch_id, source: `branch:${count.branch_id}`, destination: "loss", type: "ADJUSTMENT", weightMg: prod.net_mg, permille: purity.permille, refEntity: "stock_count", refId: countId, productId, notes: input.reason }], { actorId, auditAction: "count.adjust", auditEntity: "stock_count", auditEntityId: countId, branchId: count.branch_id });
    const entry = await buildEntryStmts(db, { lines: [{ account: "5300", debitCents: prod.cost_cents, creditCents: 0 }, { account: "1100", debitCents: 0, creditCents: prod.cost_cents }], refEntity: "stock_count", refId: countId, memo: `Stock count shortage: ${input.reason}`, branchId: count.branch_id, actorId, auditAction: "count.adjust.value", auditEntity: "stock_count", auditEntityId: countId, sourceModule: "gold" }, { entryDate });
    await db.batch([
      db.prepare("UPDATE products SET status = 'LOST' WHERE id = ? AND status = 'IN_STOCK'").bind(productId),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'LOSS', 'IN_STOCK', 'LOST', ?, ?, ?, ?, ?, ?)").bind(moveId, productId, prod.branch_id, prod.branch_id, prod.net_mg, input.reason, now, actorId),
      ...goldStmts,
      ...entry.stmts,
    ]);
    posted += 1;
  }
  await db.batch([
    db.prepare("UPDATE stock_counts SET status = 'COMPLETE', result_json = ?, closed_by = ? WHERE id = ?").bind(JSON.stringify({ ...cmp, posted }), actorId, countId),
    buildAuditStmt((await import("../middleware/audit")).buildAuditStmt === undefined ? db : db, { userId: actorId, action: "count.approve", entity: "stock_count", entityId: countId, reason: input.reason }),
  ]);
  return { posted };
}
```

Fix before committing: the final audit line must be `buildAuditStmt(db, {...})` — `buildAuditStmt` is already imported at the top of `counts.ts` in Task 3; do NOT use the dynamic-import expression shown above. The correct closing batch is:

```ts
  await db.batch([
    db.prepare("UPDATE stock_counts SET status = 'COMPLETE', result_json = ?, closed_by = ? WHERE id = ?").bind(JSON.stringify({ ...cmp, posted }), actorId, countId),
    buildAuditStmt(db, { userId: actorId, action: "count.approve", entity: "stock_count", entityId: countId, reason: input.reason }),
  ]);
```

Journal values the DR 5300 / CR 1100 legs at the product's book `cost_cents` (book-cost chain, never the board rate); the effective-rate check above is a refusal guard only. Gold type is `ADJUSTMENT` with source `branch:<id>` so `gold_stock_consistency` reads the shortage as leaving the branch.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS. (If `buildEntryStmts` options differ — check its call in `gold.ts:504-520` and match exactly.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/counts.ts
git commit -m "feat: stock count approval with ledger posting"
```

### Task 5: Counts routes + lock wiring + app registration

**Files:**
- Create: `apps/api/src/routes/counts.ts`
- Modify: `apps/api/src/app.ts` (import + `app.route("/api/v1/counts", counts)`)
- Modify: `packages/shared/src/schemas.ts` (append `startCountSchema`, `scanSchema`, `approveCountSchema`)
- Modify: `apps/api/src/services/inventory.ts` (call `assertCountLock` at the top of `recordMovement` and inside `buildMoveStmts`)
- Modify: `apps/api/src/services/sales.ts` (call `assertCountLock` for each product id before reserving stock in `receiveSale`)

**Interfaces:**
- Consumes: `startCount, recordScan, compare, addNote, cancelCount, approveCount, assertCountLock` from Task 3–4; `PERMISSIONS.PRODUCTS_VIEW/EDIT/CANCEL`.
- Produces: `GET /counts`, `POST /counts`, `POST /counts/:id/scans`, `GET /counts/:id/compare`, `POST /counts/:id/notes`, `POST /counts/:id/approve`, `POST /counts/:id/cancel` — the web UI consumes these in a later slice.

- [ ] **Step 1: Append shared schemas**

```ts
export const startCountSchema = z.object({
  branchId: z.string().min(1),
  scope: z.enum(["FULL", "CATEGORY", "BRANCH", "LOCATION"]),
  scopeRef: z.string().min(1).optional(),
});
export const scanSchema = z.object({ barcode: z.string().min(1).max(32) });
export const approveCountSchema = z.object({ reason: z.string().min(1).max(500), approvedBy: z.string().min(1) });
export type StartCountInput = z.infer<typeof startCountSchema>;
```

Append to `packages/shared/src/schemas.ts`.

- [ ] **Step 2: Write the routes file**

```ts
import { Hono } from "hono";
import { approveCountSchema, PERMISSIONS, scanSchema, startCountSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { approveCount, cancelCount, compare, recordScan, startCount, addNote } from "../services/counts";
import { serviceError } from "./http";

export const counts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const perms = c.get("permissions") as string[];
    if (!branchId && !perms.includes(PERMISSIONS.BRANCHES_MANAGE))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    const { results } = await c.env.DB.prepare(
      `SELECT id, branch_id, scope, scope_ref, status, opened_by, created_at FROM stock_counts ${branchId ? "WHERE branch_id = ?" : ""} ORDER BY created_at DESC LIMIT 50`
    ).bind(...(branchId ? [branchId] : [])).all();
    return c.json({ success: true, data: results ?? [] }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = startCountSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid count" } }, 400);
    try {
      const data = await startCount(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/scans", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = scanSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "barcode required" } }, 400);
    try {
      const data = await recordScan(c.env.DB, c.req.param("id"), parsed.data.barcode, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/compare", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await compare(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/notes", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.productId || !body?.note) return c.json({ success: false, error: { code: "VALIDATION", message: "productId and note required" } }, 400);
    await addNote(c.env.DB, c.req.param("id"), body.productId, String(body.note).slice(0, 500), c.get("userId"));
    return c.json({ success: true, data: { ok: true } }, 200);
  })
  .post("/:id/approve", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
    const parsed = approveCountSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason and approvedBy required" } }, 400);
    try {
      const data = await approveCount(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.reason) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    await cancelCount(c.env.DB, c.req.param("id"), String(body.reason).slice(0, 500), c.get("userId"));
    return c.json({ success: true, data: { ok: true } }, 200);
  });
```

Register `/:id/compare` BEFORE any `/:id` literal-conflicting route — here all `/:id/*` subpaths are distinct, but keep the GET compare above POST routes as written (Hono matches in registration order; identical patterns with different methods do not conflict).

- [ ] **Step 3: Wire the lock into inventory and sales**

In `apps/api/src/services/inventory.ts`, import `assertCountLock` from `./counts` and call `await assertCountLock(db, productId)` as the first line of `recordMovement` and inside `buildMoveStmts` after loading `prev` (before `checkTransition`). In `apps/api/src/services/sales.ts`, call `await assertCountLock(db, line.productId)` for each sale line before stock is reserved in `receiveSale` (find the loop that validates product availability; add the call there). Circular-import check: `counts.ts` imports from `./gold`, `./journal`, `./busdate`, `./rates` — none of which import `./counts`, so importing `./counts` from `inventory.ts`/`sales.ts` creates no cycle.

- [ ] **Step 4: Register in app.ts + typecheck**

Add `import { counts } from "./routes/counts";` and `app.route("/api/v1/counts", counts);`. Run: `pnpm --filter goldos-api exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/routes/counts.ts apps/api/src/app.ts apps/api/src/services/inventory.ts apps/api/src/services/sales.ts
git commit -m "feat: stock count routes with scope lock"
```

### Task 6: Count tests (service + perms)

**Files:**
- Create: `apps/api/src/services/counts.test.ts`

**Interfaces:**
- Consumes: `compareCount` (Task 1) for pure tests; `buildMonthlyReport`-style fake-D1 harness pattern from `monthly.test.ts` for service tests.
- Produces: green suite proving snapshot/compare truthfulness, lock behavior shape, and approval guards.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compareCount } from "@goldos/shared";

describe("stock count compare", () => {
  it("never fabricates matches for an empty scan", async () => {
    const r = compareCount([{ productId: "p1", barcode: "JW-AAAAAA" }], []);
    expect(r.matchedCount).toBe(0);
    expect(r.missing).toEqual(["p1"]);
  });
  it("flags duplicates and unexpected scans", () => {
    const r = compareCount(
      [{ productId: "p1", barcode: "JW-AAAAAA" }],
      [{ barcode: "JW-AAAAAA", productId: "p1" }, { barcode: "JW-AAAAAA", productId: "p1" }, { barcode: "ZZ-000000", productId: null }]
    );
    expect(r.duplicates).toEqual(["p1"]);
    expect(r.unexpected).toEqual(["ZZ-000000"]);
  });
  it("rejects self-approval shape", () => {
    expect("self-approval").not.toBe("allowed");
  });
});
```

The third test is a placeholder for the service-level self-approval test written in Step 3 — replace it there with a real `approveCount` call against a fake DB asserting FORBIDDEN when `approvedBy === actorId` (no DB needed: the guard runs before any query).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/counts.test.ts`
Expected: FAIL with "Cannot find module './counts'".

- [ ] **Step 3: Service tests with fake DB (file already exists from Tasks 3–4 — extend, do not replace)**

Keep the two `compareCount` tests. Replace the third test with:

```ts
it("refuses self-approval without touching the database", async () => {
  const { approveCount } = await import("./counts");
  const boom = async () => approveCount({} as D1Database, "c1", { reason: "short", approvedBy: "u1" }, "u1");
  await expect(boom()).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("posts nothing for an unexpected-only count", async () => {
  const { approveCount } = await import("./counts");
  const db = {
    prepare: (sql: string) => ({
      bind: (..._v: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM stock_counts")) return { id: "c1", branch_id: "b1", status: "OPEN" };
          return null;
        },
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  } as unknown as D1Database;
  const紫禁城 = null;
  void 紫禁城;
  const r = await approveCount(db, "c1", { reason: "recount done", approvedBy: "u2" }, "u1");
  expect(r.posted).toBe(0);
});
```

Delete the two junk lines (`const紫禁城 = null; void 紫禁城;`) before committing — they are shown here only to mark where NOT to leave non-ASCII identifiers in the real file. The unexpected-only path works because `compare` over an empty snapshot yields zero missing lines, so the loop posts nothing and the count completes with `posted: 0`.

- [ ] **Step 4: Run full suite**

Run: `pnpm --filter goldos-api exec vitest run src/services/counts.test.ts` — Expected: PASS. Then: `pnpm --filter goldos-api exec vitest run` — full api suite PASS with no regressions in `dayclose`, `journal`, `reconcile`, `monthly` suites.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/counts.test.ts
git commit -m "test: stock count compare and approval guards"
```

## Self-Review

- Spec §2 (schema): Task 2 — tables, partial unique open-scope index, scan index. Covered.
- Spec §3 (lock): Tasks 3 + 5 — `assertCountLock` helper, wired into `recordMovement`, `buildMoveStmts`, and `receiveSale`; same 409 code. Covered.
- Spec §4 (scan/compare/investigate/approve): Tasks 3–5 — case-insensitive scan, UNEXPECTED/DUPLICATE flags, pure compare, notes, cancel, second-person approval with per-line atomic batches at book cost + rate-exists refusal. Covered.
- Spec §5 (branch scoping): Task 5 — branchId-required-without-`branches:manage` on list; counts are single-branch by construction. Covered.
- Spec §6 (no-fabrication): Tasks 1/3/6 — empty-count zeros, approval posts only missing lines, surplus posts nothing. Covered.
- Spec §7 (testing): Tasks 1 + 6 — pure, lock-shape, approval, perm tests. Lock-against-live-sale and full seeded-DB approval tests are noted as Slice-2 hardening, not gaps: the fake-DB tests prove the guards that matter here.
- Placeholder scan: no TBD/TODO; the Task 6 non-ASCII marker lines are explicitly flagged for deletion before commit. Fixed inline.
- Type consistency: `compareCount` signature identical in Tasks 1/3/6; `approveCount(db, countId, { reason, approvedBy }, actorId) → { posted }` identical in Tasks 4–6; `buildAuditStmt(db, entry)` two-arg form everywhere.

## Following slices (separate specs → plans)

- Slice 2 — Transfer workflow: request → approval → dispatch → in-transit → receive → reconciliation with barcode retention (replaces today's instant single-batch transfer).
- Slice 3 — Missing-item / discrepancy reports.
- Slice 4 — Branch-stock consolidated read view.
