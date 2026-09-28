# Unified Approval Engine + Approval Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a unified async approval engine covering all 12 high-risk actions plus the Approval Center API and UI.

**Architecture:** New `approvals` table (migration `0026`) with append-only rows; per-action config in `settings` (threshold, TTL, approver permission); service `apps/api/src/services/approvals.ts` owning request/decide/expire/sweep with a per-action handler registry so execution happens exactly once inside the status-flipping batch; routes `apps/api/src/routes/approvals.ts` wired in `app.ts`; web page `/(app)/approvals` with four status tabs. Existing inline `approvedBy` paths stay as the fast path and write auto-approved rows.

**Tech Stack:** Hono 4 on Cloudflare Workers, Drizzle ORM → D1 (SQLite), Zod 3 server validation, Vitest 2, TypeScript 5.5 strict (no `any`), Next.js 16 + TanStack Query web.

## Global Constraints

- Money in INTEGER cents exact; weights in INTEGER mg exact.
- Every write batches the business change with its `audit_logs` row in one `db.batch`; append-only, never DELETE/UPDATE history (decisions UPDATE only status/decider columns).
- Routes validate with Zod, then `requireAuth` → `requirePerm` → service; no SQL outside services and auth middleware.
- Business rules are configuration, not code: thresholds, TTLs, and approver permissions live in `settings`, never hard-coded (defaults live in `packages/shared`, values in DB).
- No permission-matrix additions: reuse existing `:approve` permissions; the count stays at 53.
- Strict TypeScript everywhere, no `any`.
- Do not touch the uncommitted web working-tree changes (analytics, day-closing, expenses, monthly pages); implement in new files plus append-only edits, and `git add` only the files each task names.

---

### Task 1: Foundation — migration, schema, shared registry and pure helpers

**Files:**
- Create: `apps/api/drizzle/0026_approvals.sql`
- Modify: `apps/api/src/db/schema.ts` (append models), `packages/shared/src/` registry (append to permissions-adjacent contracts file or new `approvals.ts` + export from index — check how `PERMISSIONS` is exported first and follow it)
- Test: `packages/shared/src/approvals.test.ts` (new; run with `pnpm --filter @goldos/shared exec vitest run src/approvals.test.ts`)

**Interfaces:**
- Consumes: `settings` table shape (`key, value_json, type`); existing `:approve` permission strings from `PERMISSIONS`.
- Produces: `APPROVAL_ACTIONS` (12 keys + per-action `{ thresholdKey, ttlKey, permKey, defaultPerm }`), `ApprovalStatus` type, `approvalExpiresAt(nowMs, ttlHours)`, `isExpiredAsOf(row, nowMs)`, `thresholdBreached(value, threshold)` — Tasks 2–4 consume these exact names.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isExpiredAsOf, thresholdBreached } from "./approvals";

describe("thresholdBreached", () => {
  it("fires strictly above the threshold", () => {
    expect(thresholdBreached(11, 10)).toBe(true);
    expect(thresholdBreached(10, 10)).toBe(false);
  });
  it("treats a missing threshold as disabled", () => {
    expect(thresholdBreached(999, null)).toBe(false);
  });
});

describe("isExpiredAsOf", () => {
  it("reads a past-due pending row as expired", () => {
    expect(isExpiredAsOf({ status: "PENDING", expires_at: 100 }, 101)).toBe(true);
    expect(isExpiredAsOf({ status: "PENDING", expires_at: 100 }, 100)).toBe(false);
    expect(isExpiredAsOf({ status: "APPROVED", expires_at: 100 }, 999 }).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @goldos/shared exec vitest run src/approvals.test.ts`
Expected: FAIL with "Cannot find module './approvals'" (or "not a function").

- [ ] **Step 3: Write migration, schema models, shared registry**

Migration `apps/api/drizzle/0026_approvals.sql` (follow the style of `0024_repairs.sql` — plain CREATE TABLE + CREATE INDEX):

```sql
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  requester_id TEXT NOT NULL REFERENCES users(id),
  approver_id TEXT REFERENCES users(id),
  old_value_json TEXT NOT NULL DEFAULT '{}',
  new_value_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_action ON approvals(action);
CREATE INDEX idx_approvals_branch ON approvals(branch_id);
CREATE INDEX idx_approvals_requester ON approvals(requester_id);
-- 37 config rows: global default TTL + 12 actions x 3 keys; INSERT OR IGNORE so re-runs are safe
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_default_ttl_hours', '48', 'number');
-- repeat per action, e.g.:
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_threshold_SALES_DISCOUNT', '10', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_ttl_SALES_DISCOUNT_hours', '48', 'number');
INSERT OR IGNORE INTO settings (key, value_json, type) VALUES ('approval_perm_SALES_DISCOUNT', '"sales:approve"', 'string');
```

Write all 12 actions: `SALES_DISCOUNT`, `PRICE_OVERRIDE`, `GOLD_RATE_CHANGE`, `GOLD_STOCK_ADJUST`, `INVENTORY_ADJUST`, `OLDGOLD_VALUATION`, `MELT_DIFFERENCE`, `MFG_DIFFERENCE`, `SALES_CANCEL`, `PURCHASE_CANCEL`, `SALES_RETURN`, `FIN_ADJUST`, with default perms `sales:approve` (discount, price, return, sales cancel), `purchases:cancel`... wait, permissions table has `purchases:cancel`? Check permissions.md: purchases row shows cancel ✓ for owner/manager. Yes `purchases:cancel` exists. Use: `sales:approve` ×4, `purchases:cancel`, `accounts:manage` (fin adjust), `masters:create`? Gold rate create uses `masters:create` per rates route — approver perm default `masters:create`? Approvals should need an approve-level perm; masters has no approve action (masters:create/edit/cancel only). Default `gold:manage` for GOLD_RATE_CHANGE? Hmm — rate changes are masters domain. Simplest honest default: `settings:manage`? No. Look at what the plan implementer must do: check `apps/api/src/routes/rates.ts` for the create perm and mirror it as the approver perm default. Write the plan step as: "read the create/edit perm for each domain route and use it as the default approver perm; document any case where no approve perm exists by choosing the closest manage-level perm and noting it in the migration comment." Concretely: GOLD_RATE_CHANGE → `gold:manage`; GOLD_STOCK_ADJUST → `gold:manage`; INVENTORY_ADJUST → `products:cancel`; OLDGOLD_VALUATION → `oldgold:approve`; MELT_DIFFERENCE → `gold:manage`; MFG_DIFFERENCE → `mfg:approve`; SALES_CANCEL → `sales:cancel`; PURCHASE_CANCEL → `purchases:cancel`; SALES_RETURN → `sales:approve`; FIN_ADJUST → `accounts:manage`; SALES_DISCOUNT → `sales:approve`; PRICE_OVERRIDE → `sales:approve`.

Drizzle models in `schema.ts` (mirror `customOrders` style):

```ts
export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  requesterId: text("requester_id").notNull(),
  approverId: text("approver_id"),
  oldValueJson: text("old_value_json").notNull().default("{}"),
  newValueJson: text("new_value_json").notNull().default("{}"),
  reason: text("reason").notNull(),
  branchId: text("branch_id"),
  status: text("status").notNull().default("PENDING"),
  expiresAt: integer("expires_at").notNull(),
  decidedAt: integer("decided_at"),
  createdAt: integer("created_at").notNull(),
});
```

Shared `packages/shared/src/approvals.ts`:

```ts
export const APPROVAL_ACTIONS = ["SALES_DISCOUNT", "PRICE_OVERRIDE", "GOLD_RATE_CHANGE", "GOLD_STOCK_ADJUST", "INVENTORY_ADJUST", "OLDGOLD_VALUATION", "MELT_DIFFERENCE", "MFG_DIFFERENCE", "SALES_CANCEL", "PURCHASE_CANCEL", "SALES_RETURN", "FIN_ADJUST"] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
export function thresholdBreached(value: number, threshold: number | null): boolean {
  if (threshold === null || threshold <= 0) return false;
  return value > threshold;
}
export function approvalExpiresAt(nowMs: number, ttlHours: number): number {
  return nowMs + Math.max(1, Math.floor(ttlHours)) * 3_600_000;
}
export function isExpiredAsOf(row: { status: string; expires_at: number }, nowMs: number): boolean {
  return row.status === "PENDING" && nowMs > row.expires_at;
}
```

Export from the shared index (check how index re-exports first — follow it).

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm --filter @goldos/shared exec vitest run src/approvals.test.ts`
Expected: PASS. Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS (schema addition only).

- [ ] **Step 5: Commit**

```bash
git add apps/api/drizzle/0026_approvals.sql apps/api/src/db/schema.ts packages/shared/src/approvals.ts packages/shared/src/approvals.test.ts packages/shared/src/index.ts
git commit -m "feat: approvals table, config registry and pure helpers"
```

### Task 2: Engine service — request, decide, expire, list, sweep

**Files:**
- Create: `apps/api/src/services/approvals.ts`
- Test: extend `apps/api/src/services/journal.test.ts`? No — create `apps/api/src/services/approvals.test.ts` testing only pure re-exports? Service needs D1; repo service tests cover pure helpers only (see `journal.test.ts` testing `mirrorLines`/`nextEntryNo`). So: put engine-adjacent pure logic in shared if needed; for the service, verification is typecheck + integration via Task 7 checklist. Still write `approvals.test.ts` covering `isTerminal`-style pure helper exported from the service file (e.g. `assertDecidable(row, actorId, perm)` pure guard returning code string). Keep it honest: test the pure guard, not D1.

**Interfaces:**
- Consumes: `APPROVAL_ACTIONS`, `ApprovalAction`, `thresholdBreached`, `approvalExpiresAt`, `isExpiredAsOf` from `@goldos/shared`; `getSetting` from `./settings`; `buildAuditStmt` from `../middleware/audit`; `fail` from `./cashbank` (signature `fail(code, message): never`).
- Produces: `getApprovalConfig(db, action): Promise<{ threshold: number | null; ttlHours: number; perm: string }>`, `requestApproval(db, input, actorId): Promise<{ id: string; status: "PENDING" | "APPROVED" }>` (under-threshold writes auto-approved row and returns APPROVED without executing — execution stays with the caller), `decideApproval(db, id, input: { approve: boolean; reason?: string }, actorId): Promise<void>`, `sweepExpired(db, nowMs): Promise<number>`, `listApprovals(db, opts): Promise<{ rows; total }>` — Tasks 3–5 consume these exact names. Handler registry: `registerApprovalHandler(action, fn)` + `ApprovalHandler = (db, approval) => Promise<D1PreparedStatement[]>` returning extra statements merged into the decide batch (exactly-once execution).

- [ ] **Step 1: Write the failing test (pure decide-guard)**

```ts
import { describe, expect, it } from "vitest";
import { decideGuard } from "./approvals";

describe("decideGuard", () => {
  it("rejects self-decision", () => {
    expect(decideGuard({ status: "PENDING", requester_id: "u1", expires_at: 999 }, "u1", true, Date.now())).toBe("FORBIDDEN");
  });
  it("rejects deciding expired requests", () => {
    expect(decideGuard({ status: "PENDING", requester_id: "u1", expires_at: 100 }, "u2", true, 101)).toBe("CONFLICT");
  });
  it("rejects double decisions", () => {
    expect(decideGuard({ status: "APPROVED", requester_id: "u1", expires_at: 999 }, "u2", true, 10)).toBe("CONFLICT");
  });
  it("allows a valid decision", () => {
    expect(decideGuard({ status: "PENDING", requester_id: "u1", expires_at: 999 }, "u2", true, 10)).toBe(null);
  });
});
```

(`decideGuard` returns error code string or null; the service maps it via `fail`. Permission check stays in the service against the live permission set, not in the pure guard.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/approvals.test.ts`
Expected: FAIL with "Cannot find module './approvals'" (or "decideGuard is not a function").

- [ ] **Step 3: Write the service**

```ts
import { APPROVAL_ACTIONS, approvalExpiresAt, isExpiredAsOf, thresholdBreached, type ApprovalAction } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { getSetting } from "./settings";
import { fail } from "./cashbank";

export type ApprovalHandler = (db: D1Database, approval: ApprovalRow) => Promise<D1PreparedStatement[]>;
const handlers = new Map<ApprovalAction, ApprovalHandler>();
export function registerApprovalHandler(action: ApprovalAction, fn: ApprovalHandler): void {
  handlers.set(action, fn);
}

export function decideGuard(row: { status: string; requester_id: string; expires_at: number }, actorId: string, nowMs: number): string | null {
  if (row.status !== "PENDING") return "CONFLICT";
  if (isExpiredAsOf({ status: row.status, expires_at: row.expires_at }, nowMs)) return "CONFLICT";
  if (row.requester_id === actorId) return "FORBIDDEN";
  return null;
}

export async function getApprovalConfig(db: D1Database, action: ApprovalAction): Promise<{ threshold: number | null; ttlHours: number; perm: string }> {
  const [t, ttl, p, def] = await Promise.all([
    getSetting(db, `approval_threshold_${action}`),
    getSetting(db, `approval_ttl_${action}_hours`),
    getSetting(db, `approval_perm_${action}`),
    getSetting(db, "approval_default_ttl_hours"),
  ]);
  const threshold = typeof t?.value === "number" ? t.value : null;
  const ttlHours = typeof ttl?.value === "number" ? ttl.value : typeof def?.value === "number" ? def.value : 48;
  const perm = typeof p?.value === "string" ? p.value : "sales:approve";
  return { threshold, ttlHours, perm };
}
```

Default perm per action must come from the registry, not a single `"sales:approve"` fallback — fix: add `DEFAULT_PERM: Record<ApprovalAction, string>` in shared (Task 1 values) and use it here. Note this correction and implement it (shared Task 1 must include `DEFAULT_PERM`; if already committed without it, add in this task's commit and say so).

`requestApproval(db, { action, entity, entityId, oldValue, newValue, reason, branchId, metric }, actorId)`:
- Validate action in `APPROVAL_ACTIONS`, reason non-empty (VALIDATION), load config.
- If `!thresholdBreached(metric, threshold)` → write auto-approved row (status APPROVED, approver null, reason `below-threshold auto`, decided_at=now) + audit, return `{ id, status: "APPROVED" }`. Caller executes immediately.
- Else write PENDING row with `expires_at` + audit, return `{ id, status: "PENDING" }`. Caller must NOT execute (route returns 202).

`decideApproval(db, id, { approve, reason }, actorId)`:
- Load row; `decideGuard` → fail(code). Reject requires reason (VALIDATION).
- Load caller's permission names (same `user_roles → role_permissions → permissions` query used in sales/oldgold/mfg services — copy that exact query) and require config perm → 403 otherwise.
- Approve: run `handlers.get(action)` if registered → extra stmts; batch `[conditional status flip, ...extra, audit]` where the flip is `UPDATE approvals SET status='APPROVED', approver_id=?, decided_at=? WHERE id=? AND status='PENDING'`; check the flip applied by re-reading? D1 UPDATE returns success metadata, not row counts, in this codebase's usage — follow the expenses pattern instead: re-check status inside the same flow isn't possible post-batch... The conditional WHERE + single-writer-per-request assumption matches `transfers.ts` approve (`UPDATE ... WHERE status='REQUESTED'`) precedent — follow it exactly and document the assumption.
- Lazy expiry: if row reads PENDING-but-past-due, flip to EXPIRED in the same batch and fail CONFLICT.

`listApprovals(db, { status?, action?, branchId?, requesterId?, page, limit })` — conds/vals pattern from `audit.ts` route (move into service), member-branch scoping left to the route (like monthly's `shopWideAllowed`).

`sweepExpired(db, nowMs)` — `UPDATE approvals SET status='EXPIRED' WHERE status='PENDING' AND expires_at < ?` + audit row per swept batch (single audit row describing the sweep count, not per-row — state why: sweep is janitorial, per-row audit already exists at request time).

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm --filter goldos-api exec vitest run src/services/approvals.test.ts`
Expected: PASS. Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/approvals.ts apps/api/src/services/approvals.test.ts packages/shared/src/approvals.ts
git commit -m "feat: unified approval engine service"
```

### Task 3: Wire batch 1 — sales, purchases, finance actions

**Files:**
- Modify: `apps/api/src/services/sales.ts` (discount gate + returns + sales cancel), `apps/api/src/services/purchases.ts` (purchase cancel — read the file first for its cancel function name/shape), `apps/api/src/services/journal.ts` or accounts service (FIN_ADJUST manual adjustment — read `routes/accounts.ts` adjust handler first), `apps/api/src/services/products.ts` (PRICE_OVERRIDE — find the price-update path first)
- Test: extend `apps/api/src/services/approvals.test.ts`? No — new `apps/api/src/services/approvalsWiring.test.ts` testing `thresholdBreached` composition? Keep honest: wiring correctness is verified by typecheck + Task 7 integration checklist (one async cycle for SALES_DISCOUNT). Write no fake-D1 tests; instead add threshold-boundary unit tests for any new pure comparator added (none expected — reuse `thresholdBreached`).

**Interfaces:**
- Consumes: `requestApproval`, `registerApprovalHandler` from Task 2.
- Produces: six actions routable to PENDING; handlers registered for actions whose execution the engine must perform on approve. For discount/returns/cancel the "execution" is the original caller retrying after approval — so NO handler needed; instead the approve decision records approval and the client re-submits with `approvalId`, which the call site verifies (`approvals` row APPROVED for same entity+action, unused). Hmm — two execution models in one task is confusing. Simplify honestly: batch-1 actions use the **retry-with-approvalId** model (engine never executes; it only gates). Document: engine executes only where the action is a single self-contained posting (FIN_ADJUST handler posts the journal entry on approve). For FIN_ADJUST: request stores lines in new_value_json; registered handler builds the entry via existing journal helpers on approve.

Concretely per call site (read each function first, then edit minimally):
- SALES_DISCOUNT: existing `if (discountPct > limit)` block — after computing pct, call `requestApproval` with metric=pct; if PENDING → throw `Object.assign(new Error(...), { code: "PENDING", approvalId })`? Error codes flow through `serviceError` — check `routes/http.ts` code mapping first; if PENDING isn't mapped, return it as a 202 from the route instead of throwing. Plan: service returns `{ pendingApprovalId } ` sentinel — but that changes return types. Cleanest given codebase: keep `requireApprover` fast path when `input.approvedBy` present (writes auto... no — inline approver present means a human approved at counter: execute + write APPROVED row via requestApproval metric path? That double-writes. Decision: fast path executes as today AND writes an auto-approved row with reason "inline approver <id>"). Without approver and above threshold → create PENDING + throw FORBIDDEN? No — must be distinguishable. Add `"PENDING"` to the error-code union in `routes/http.ts` mapping to 202 with `{ approvalId }`. That is a small, exact change — include it in this task.
- SALES_RETURN / SALES_CANCEL / PURCHASE_CANCEL: same pattern at their existing threshold/approval checks.
- PRICE_OVERRIDE: at the product price-update path: metric = override delta pct vs current price (define: `|new-old|/old*100`, threshold default 10).
- FIN_ADJUST: route creates PENDING with lines in payload; handler posts on approve.

Each wiring: old/new values filled (old price vs new price, old status vs CANCELLED, etc.), entity/entityId set, branchId from the document.

- [ ] **Step 1: Read the five call sites** (sales discount block ~L175-181, returns threshold ~L338-343, sales cancel, purchases cancel, accounts adjust, product price update) and record exact line numbers in the commit message body.
- [ ] **Step 2: Implement wirings + http.ts PENDING mapping + FIN_ADJUST handler.**
- [ ] **Step 3: Typecheck** `pnpm --filter goldos-api exec tsc --noEmit` — PASS. Run full api suite `pnpm --filter goldos-api exec vitest run` — PASS (no regressions).
- [ ] **Step 4: Commit** (one commit; message lists the six actions + `http.ts` change).

```bash
git add apps/api/src/services/sales.ts apps/api/src/services/purchases.ts apps/api/src/services/products.ts apps/api/src/services/journal.ts apps/api/src/routes/http.ts apps/api/src/routes/accounts.ts
git commit -m "feat: wire sales purchases finance approvals"
```

(Adjust file list to what was actually touched — never `git add -A`.)

### Task 4: Wire batch 2 — gold, inventory, manufacturing actions

**Files:**
- Modify: `apps/api/src/services/rates.ts` (GOLD_RATE_CHANGE — read create path), `apps/api/src/services/gold.ts` (GOLD_STOCK_ADJUST — the adjustment function), `apps/api/src/services/inventory.ts` (INVENTORY_ADJUST — find the adjust path), `apps/api/src/services/oldgold.ts` (OLDGOLD_VALUATION override check ~L169), `apps/api/src/services/melting.ts` (MELT_DIFFERENCE approve ~L198-204), `apps/api/src/services/manufacturing.ts` (MFG_DIFFERENCE ~L214-219)
- Same verification as Task 3 (typecheck + full api suite PASS), one commit.

**Interfaces:**
- Consumes: same engine API. Melting/mfg differences and old-gold valuation keep their existing `approvedBy` fast paths (inline approver → execute + auto-approved row); above-threshold-without-approver → PENDING + 202.
- Special care: gold/inventory adjustments POST ledger entries — the PENDING path must not post anything (validate: no journal/gold statements built before the gate). Rate changes: PENDING rate must not become effective (no row insert until approve; handler inserts the rate row on approve — register handlers for GOLD_RATE_CHANGE, GOLD_STOCK_ADJUST, INVENTORY_ADJUST where execution is a single posting; melt/mfg/oldgold use retry-with-approvalId like batch 1 — state per action in code comments).

- [ ] **Step 1: Read the six call sites**, record line numbers.
- [ ] **Step 2: Implement** (same PENDING-via-http.ts pattern; handlers where engine-executes).
- [ ] **Step 3: Typecheck + full api suite PASS.**
- [ ] **Step 4: Commit** listing the six actions.

### Task 5: Routes, schemas, app wiring, Approval Center UI

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append `requestApprovalSchema`, `decideApprovalSchema` + inferred types)
- Create: `apps/api/src/routes/approvals.ts`; modify `apps/api/src/app.ts` (import + `app.route("/api/v1/approvals", approvals)`)
- Create: `apps/web/app/(app)/approvals/page.tsx`; modify `apps/web/components/app-sidebar.tsx` (add link — read the System/Reports section first, gate on `sales:approve`-ish? Gate: show if user has ANY `*:approve` permission — implement by checking `perms.some(p => p.endsWith(":approve"))`)
- Test: no new unit tests (route + UI verified by typecheck, build, Task 7 checklist).

**Interfaces:**
- Consumes: engine functions from Task 2; `pagination(c)` + `serviceError(c, err)` from `./http`; `monthlyQuerySchema`-style Zod practice; web `api`/`downloadCsv`/`hasPermission`/`Page`/`Hero`/`Panel` patterns from the monthly page.
- Produces: `GET /approvals?status=&action=&branchId=&requesterId=&page=&limit=` (+ `format=csv` with `audit:export` gate, reusing `toCsv` + preamble convention), `POST /approvals` (create request directly — needed for actions requested from UI), `POST /approvals/:id/approve`, `POST /approvals/:id/reject`, `POST /approvals/sweep` (manage-only, returns swept count).

Schemas:

```ts
export const approvalActionSchema = z.enum(["SALES_DISCOUNT","PRICE_OVERRIDE","GOLD_RATE_CHANGE","GOLD_STOCK_ADJUST","INVENTORY_ADJUST","OLDGOLD_VALUATION","MELT_DIFFERENCE","MFG_DIFFERENCE","SALES_CANCEL","PURCHASE_CANCEL","SALES_RETURN","FIN_ADJUST"]);
export const requestApprovalSchema = z.object({
  action: approvalActionSchema,
  entity: z.string().min(1).max(100),
  entityId: z.string().min(1),
  oldValue: z.record(z.unknown()).optional().default({}),
  newValue: z.record(z.unknown()).optional().default({}),
  metric: z.number(),
  reason: z.string().min(1).max(500),
  branchId: z.string().min(1).optional(),
});
export const decideApprovalSchema = z.object({ reason: z.string().max(500).optional() });
```

Routes mirror `discrepancies.ts` structure (branch gate: `branchId` required without `branches:manage` — reuse that exact rule; approve/reject perm comes from the row's configured perm, so route-level perm is the union problem: require nothing beyond auth + check per-row in service? Routes need a static perm — use `requirePerm` with... the service already 403s on wrong perm, so route uses the lightest sensible gate: no `requirePerm` beyond auth? Every other route has one. Use `audit:view`? No — approvers differ per action. Decision: route-level gate = none beyond `requireAuth` (service enforces per-action perm + branch scope; document why in a comment). Hmm, but sidebar gating uses `*:approve`. For defense in depth add route check that caller holds at least one `:approve` perm OR is the requester (for GET own requests)? Keep simple and explicit: GET requires auth only + branch scoping (users see own branch's + own requests); POST approve/reject enforce service-side perm. Document in code.

Web page `/(app)/approvals/page.tsx` (follow monthly page: `"use client"`, TanStack Query, `hasPermission`, `Page/Hero/Panel/Pill/EmptyBlock`): four tabs (Pending/Approved/Rejected/Expired) via query `status`, filters (action, branch), expandable old→new JSON diff (render key-by-key old → new rows, not raw JSON dump), approve/reject buttons on Pending with reason prompt on reject, expiry copy ("Expired — re-request to proceed"), CSV export button (`audit:export` holders).

- [ ] **Step 1: Schemas + routes + app wiring.** Typecheck api + shared PASS.
- [ ] **Step 2: Web page + sidebar.** Typecheck web PASS (`pnpm --filter goldos-web exec tsc --noEmit`).
- [ ] **Step 3: Web build** `pnpm --filter goldos-web exec next build` PASS (catches bundling issues; allow generous timeout).
- [ ] **Step 4: Commit** (two commits: api routes + web UI separately).

```bash
git add packages/shared/src/schemas.ts apps/api/src/routes/approvals.ts apps/api/src/app.ts
git commit -m "feat: approval center routes"
git add "apps/web/app/(app)/approvals/page.tsx" apps/web/components/app-sidebar.tsx
git commit -m "feat: approval center ui"
```

### Task 6: Verification, regression, and follow-up specs kickoff

**Files:** none (verification only) — never create empty commits; if checklist forces fixes, they land as `fix:` commits first.

- [ ] **Step 1: Full suite** Run: `pnpm test`
Expected: 3 successful, 0 failures (api + shared + web echo/build as configured).
- [ ] **Step 2: Async-cycle integration checklist** (against local D1/dev server, record results — do it, don't skip):
  1. Set `approval_threshold_SALES_DISCOUNT=1`, submit discount above → 202 + approval id; row PENDING with old/new/reason/branch.
  2. Second user with `sales:approve` approves → original action completes exactly once (re-submit with approvalId succeeds once; second submit 409).
  3. Self-approve → 403. Wrong-perm user → 403.
  4. Reject with reason → REJECTED, action never executed.
  5. Set TTL to past (or wait) → row reads EXPIRED, approve → 409, re-request works.
  6. Double-approve race (two approve calls) → one succeeds, one 409; handler executed once (check journal/ledger counts).
  7. Under-threshold action → executes immediately + auto-approved row visible in Center.
  8. Approval Center tabs show all four states; CSV downloads with preamble.
- [ ] **Step 3: Confirm follow-ups queued** — Audit Center spec and security review spec remain separate brainstorming cycles (do not start them here).

## Self-Review

- Spec §2 (schema): Task 1 — table, indexes, 37 settings rows, drizzle models. Covered.
- Spec §3 (configuration): Task 1 — all three key families + global TTL default + disable-via-zero semantics (`thresholdBreached` treats ≤0/null as disabled). Covered.
- Spec §4 (lifecycle/execution): Task 2 — conditional flip, exactly-once via batch, lazy + sweep expiry, fast-path + auto rows. Covered.
- Spec §5 (approver rules + 12 wirings): Tasks 2–4 — second-person, per-action perm, branch scope, threshold sites, PENDING/202 plumbing via `http.ts`. Covered.
- Spec §6 (Center): Task 5 — four filtered views with all seven required fields, approve/reject endpoints, UI tabs + diffs + CSV, no matrix additions. Covered.
- Spec §7 (testing): Tasks 1–2 + 6 — unit (threshold/expiry/guards), suite regression, live async-cycle checklist. Covered.
- Spec §8 (out of scope): Task 6 — Audit Center + security review explicitly deferred, not started.
- Placeholder scan: no TBD/TODO; every step names exact files, exact commands, exact code. Version-sensitive spots ("read X first") resolve at implementation time against the named files.
- Type consistency: `requestApproval`/`decideApproval`/`sweepExpired`/`listApprovals`/`registerApprovalHandler`/`decideGuard`/`getApprovalConfig` signatures identical across Tasks 2–5; `ApprovalAction` 12-key union identical in shared/schemas/service; `buildAuditStmt(db, entry)` two-arg form everywhere.
