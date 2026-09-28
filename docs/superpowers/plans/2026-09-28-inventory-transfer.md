# Stock Transfer Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the multi-item transfer document workflow — request, approve, dispatch, per-barcode receive, recall, cancel, reconciliation — with barcode retention and one gold TRANSFER row per line.

**Architecture:** Migration `0023_transfer_docs.sql` (`transfers` + `transfer_lines` + `TRF` counter); service `apps/api/src/services/transfers.ts` owning all transitions plus `reconcileTransfer`; dispatch posts TRANSFER_OUT movements + gold rows via the existing `postGoldStmts`; routes `apps/api/src/routes/transfers.ts` as `/api/v1/transfers`; cross-branch instant transfers through the legacy path are refused with 409.

**Tech Stack:** Hono 4 on Cloudflare Workers, Drizzle ORM → D1 (SQLite), Zod 3 server validation, Vitest 2, TypeScript 5.5 strict (no `any`).

## Global Constraints

- Money in INTEGER cents exact; gold in INTEGER fine milligrams exact; 0 tolerance for mg.
- Every write batches the business change with its `audit_logs` row in one `db.batch`; append-only, never DELETE/UPDATE history.
- Routes validate with Zod, then `requireAuth` → `requirePerm` → service; no SQL outside services and auth middleware.
- Barcodes are never rewritten by any transfer step; the product row keeps the live barcode, lines carry snapshots.
- Header status is derived from line states, never set directly.
- Listing requires a branch filter unless the caller holds `branches:manage` (same rule as counts and monthly).
- A transfer moves stock within one shop: no journal entries, no profit touch.

---

### Task 1: Transfer migration + schema

**Files:**
- Create: `apps/api/drizzle/0023_transfer_docs.sql`
- Modify: `apps/api/src/db/schema.ts` (append at end)

**Interfaces:**
- Consumes: `branches(id)`, `products(id)`, `users(id)` FK targets (already exist).
- Produces: `transfers` + `transfer_lines` tables, `TRF` counter row, `stockTransfers` / `transferLines` drizzle models used by Task 2.

- [ ] **Step 1: Write the migration file**

```sql
-- 0023_transfer_docs.sql
-- Multi-item transfer documents with per-line states.
CREATE TABLE transfers (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  from_branch_id TEXT NOT NULL REFERENCES branches(id),
  to_branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  reason TEXT,
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_tr_status ON transfers(status);
CREATE INDEX idx_tr_branches ON transfers(from_branch_id, to_branch_id);

CREATE TABLE transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  barcode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_tl_transfer_product ON transfer_lines(transfer_id, product_id);
CREATE INDEX idx_tl_status ON transfer_lines(status);

INSERT INTO counters (name, next) VALUES ('TRF', 1);
```

Save exactly as `apps/api/drizzle/0023_transfer_docs.sql`.

- [ ] **Step 2: Append drizzle schema**

```ts
export const stockTransfers = sqliteTable("transfers", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  fromBranchId: text("from_branch_id").notNull(),
  toBranchId: text("to_branch_id").notNull(),
  status: text("status").notNull().default("REQUESTED"),
  reason: text("reason"),
  requestedBy: text("requested_by"),
  approvedBy: text("approved_by"),
  createdAt: integer("created_at").notNull(),
});

export const transferLines = sqliteTable("transfer_lines", {
  id: text("id").primaryKey(),
  transferId: text("transfer_id").notNull(),
  productId: text("product_id").notNull(),
  barcode: text("barcode").notNull(),
  status: text("status").notNull().default("PENDING"),
  createdAt: integer("created_at").notNull(),
});
```

Append after `countScans` in `apps/api/src/db/schema.ts`. Name the models `stockTransfers` / `transferLines` (not `transfers`: `apps/api/src/routes/transfers.ts` in Task 5 exports a Hono app named `transfers`, and a shared model name would collide on import).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0023_transfer_docs.sql apps/api/src/db/schema.ts
git commit -m "feat: transfer document tables and TRF counter"
```

### Task 2: Transfers service — request, approve, helpers

**Files:**
- Create: `apps/api/src/services/transfers.ts`

**Interfaces:**
- Consumes: `buildAuditStmt(db, entry)` from `../middleware/audit`; `assertCountLock` from `./counts`.
- Produces: `requestTransfer`, `approveTransfer`, `loadTransfer` (header + lines), `deriveStatus(lines): string` — Task 3 consumes all four exact names/signatures.

- [ ] **Step 1: Write the service skeleton**

```ts
import { buildAuditStmt } from "../middleware/audit";
import { assertCountLock } from "./counts";

export type TransferLineState = "PENDING" | "IN_TRANSIT" | "RECEIVED" | "RECALLED";

export type TransferDoc = {
  id: string; number: string; fromBranchId: string; toBranchId: string; status: string;
  reason: string | null; requestedBy: string | null; approvedBy: string | null;
  lines: { id: string; productId: string; barcode: string; status: TransferLineState }[];
};

export function deriveStatus(lines: { status: string }[]): string {
  if (lines.every((l) => l.status === "PENDING")) return "REQUESTED";
  if (lines.every((l) => l.status === "RECEIVED" || l.status === "RECALLED")) return "COMPLETE";
  if (lines.some((l) => l.status === "IN_TRANSIT") && lines.some((l) => l.status === "RECEIVED" || l.status === "RECALLED")) return "PARTIAL";
  return "DISPATCHED";
}

export async function loadTransfer(db: D1Database, id: string): Promise<TransferDoc> {
  const head = await db.prepare("SELECT id, number, from_branch_id, to_branch_id, status, reason, requested_by, approved_by FROM transfers WHERE id = ?").bind(id).first<{ id: string; number: string; from_branch_id: string; to_branch_id: string; status: string; reason: string | null; requested_by: string | null; approved_by: string | null }>();
  if (!head) throw Object.assign(new Error("Transfer not found"), { code: "NOT_FOUND" });
  const { results } = await db.prepare("SELECT id, product_id, barcode, status FROM transfer_lines WHERE transfer_id = ?").bind(id).all<{ id: string; product_id: string; barcode: string; status: TransferLineState }>();
  return { id: head.id, number: head.number, fromBranchId: head.from_branch_id, toBranchId: head.to_branch_id, status: head.status, reason: head.reason, requestedBy: head.requested_by, approvedBy: head.approved_by, lines: (results ?? []).map((r) => ({ id: r.id, productId: r.product_id, barcode: r.barcode, status: r.status })) };
}

export async function requestTransfer(db: D1Database, input: { fromBranchId: string; toBranchId: string; productIds: string[]; reason?: string }, actorId: string): Promise<{ id: string; number: string }> {
  if (input.fromBranchId === input.toBranchId) throw Object.assign(new Error("Branches must differ"), { code: "VALIDATION" });
  if (input.productIds.length === 0 || input.productIds.length > 100) throw Object.assign(new Error("1-100 products per transfer"), { code: "VALIDATION" });
  if (new Set(input.productIds).size !== input.productIds.length) throw Object.assign(new Error("Duplicate product in transfer"), { code: "CONFLICT" });
  for (const b of [input.fromBranchId, input.toBranchId]) {
    const br = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(b).first();
    if (!br) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  }
  const now = Date.now();
  const lines: { productId: string; barcode: string }[] = [];
  for (const pid of input.productIds) {
    const p = await db.prepare("SELECT id, barcode, status, branch_id FROM products WHERE id = ?").bind(pid).first<{ id: string; barcode: string; status: string; branch_id: string }>();
    if (!p) throw Object.assign(new Error(`Product not found: ${pid}`), { code: "NOT_FOUND" });
    if (p.status !== "IN_STOCK" || p.branch_id !== input.fromBranchId)
      throw Object.assign(new Error(`Product not available at sender: ${pid}`), { code: "VALIDATION" });
    await assertCountLock(db, pid);
    lines.push({ productId: p.id, barcode: p.barcode });
  }
  const counter = await db.prepare("SELECT next FROM counters WHERE name = 'TRF'").bind().first<{ next: number }>();
  if (!counter) throw Object.assign(new Error("Counter TRF missing"), { code: "INTERNAL" });
  const number = `TRF-${String(counter.next).padStart(6, "0")}`;
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO transfers (id, number, from_branch_id, to_branch_id, status, reason, requested_by, created_at) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, ?)").bind(id, number, input.fromBranchId, input.toBranchId, input.reason ?? null, actorId, now),
    ...lines.map((l) => db.prepare("INSERT INTO transfer_lines (id, transfer_id, product_id, barcode, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', ?)").bind(crypto.randomUUID(), id, l.productId, l.barcode, now)),
    db.prepare("UPDATE counters SET next = ? WHERE name = 'TRF'").bind(counter.next + 1),
    buildAuditStmt(db, { userId: actorId, action: "transfer.request", entity: "transfer", entityId: id, next: { number, lines: lines.length } }),
  ]);
  return { id, number };
}

export async function approveTransfer(db: D1Database, id: string, approverId: string, actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (doc.status !== "REQUESTED") throw Object.assign(new Error("Transfer not awaiting approval"), { code: "CONFLICT" });
  if (approverId === doc.requestedBy) throw Object.assign(new Error("Approver cannot be the requester"), { code: "FORBIDDEN" });
  const member = await db.prepare("SELECT 1 AS x FROM branch_members WHERE user_id = ? AND branch_id = ?").bind(approverId, doc.fromBranchId).first();
  if (!member) throw Object.assign(new Error("Approver must belong to the sending branch"), { code: "FORBIDDEN" });
  const perms = await db.prepare(`SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`).bind(approverId).all<{ name: string }>();
  if (!(perms.results ?? []).some((r) => r.name === "products:cancel"))
    throw Object.assign(new Error("Approval requires products:cancel"), { code: "FORBIDDEN" });
  await db.batch([
    db.prepare("UPDATE transfers SET status = 'APPROVED', approved_by = ? WHERE id = ? AND status = 'REQUESTED'").bind(approverId, id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.approve", entity: "transfer", entityId: id, next: { approvedBy: approverId } }),
  ]);
}
```

`deriveStatus` takes effect in Task 3 (dispatch/receive/recall write it back to the header). Task 2 leaves headers at REQUESTED/APPROVED only.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/transfers.ts
git commit -m "feat: transfer request and approval"
```

### Task 3: Transfers service — dispatch, receive, recall, cancel

**Files:**
- Modify: `apps/api/src/services/transfers.ts`

**Interfaces:**
- Consumes: `requestTransfer, approveTransfer, loadTransfer, deriveStatus` from Task 2 (same file); `postGoldStmts` from `./gold`; `assertCountLock` from `./counts`.
- Produces: `dispatchTransfer, receiveLines, recallLines, cancelTransfer` — Task 5 (routes) consumes these exact names.

- [ ] **Step 1: Append dispatch + receive + recall + cancel**

```ts
import { postGoldStmts } from "./gold";
import { assertCountLock as assertLock } from "./counts";
```

Do NOT add this import — `assertCountLock` is already imported in Task 2's skeleton. Adding a second import of the same module is harmless but noisy; skip it.

```ts
export async function dispatchTransfer(db: D1Database, id: string, actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (doc.status !== "APPROVED") throw Object.assign(new Error("Transfer not approved"), { code: "CONFLICT" });
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const goldEntries: { branchId: string; source: string; destination: string; type: string; weightMg: number; permille: number; refEntity: string; refId: string; productId: string; notes?: string }[] = [];
  for (const line of doc.lines) {
    if (line.status !== "PENDING") throw Object.assign(new Error(`Line not pending: ${line.barcode}`), { code: "CONFLICT" });
    const p = await db.prepare("SELECT id, status, branch_id, net_mg, fine_gold_mg, purity_id FROM products WHERE id = ?").bind(line.productId).first<{ id: string; status: string; branch_id: string; net_mg: number; fine_gold_mg: number; purity_id: string }>();
    if (!p || p.status !== "IN_STOCK" || p.branch_id !== doc.fromBranchId)
      throw Object.assign(new Error(`Product not available at sender: ${line.barcode}`), { code: "CONFLICT" });
    await assertCountLock(db, line.productId);
    const purity = await db.prepare("SELECT permille FROM purities WHERE id = ?").bind(p.purity_id).first<{ permille: number }>();
    if (!purity) throw Object.assign(new Error("Purity not found"), { code: "VALIDATION" });
    stmts.push(
      db.prepare("UPDATE products SET status = 'TRANSFER_PENDING' WHERE id = ? AND status = 'IN_STOCK'").bind(line.productId),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'TRANSFER_OUT', 'IN_STOCK', 'TRANSFER_PENDING', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), line.productId, doc.fromBranchId, doc.toBranchId, p.net_mg, `Transfer ${doc.number}`, now, actorId),
      db.prepare("UPDATE transfer_lines SET status = 'IN_TRANSIT' WHERE id = ?").bind(line.id)
    );
    goldEntries.push({ branchId: doc.toBranchId, source: `branch:${doc.fromBranchId}`, destination: `branch:${doc.toBranchId}`, type: "TRANSFER", weightMg: p.net_mg, permille: purity.permille, refEntity: "transfer_line", refId: line.id, productId: line.productId, notes: `Transfer ${doc.number}` });
  }
  const goldStmts = await postGoldStmts(db, goldEntries, { actorId, auditAction: "transfer.dispatch", auditEntity: "transfer", auditEntityId: id, branchId: doc.toBranchId });
  stmts.push(...goldStmts);
  stmts.push(
    db.prepare("UPDATE transfers SET status = 'DISPATCHED' WHERE id = ?").bind(id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.dispatch", entity: "transfer", entityId: id, next: { lines: doc.lines.length } })
  );
  await db.batch(stmts);
}

export async function receiveLines(db: D1Database, id: string, barcodes: string[], actorId: string): Promise<{ received: string[]; skipped: string[] }> {
  const doc = await loadTransfer(db, id);
  if (!["DISPATCHED", "PARTIAL"].includes(doc.status)) throw Object.assign(new Error("Transfer not dispatched"), { code: "CONFLICT" });
  const byCode = new Map(doc.lines.map((l) => [l.barcode.toUpperCase(), l]));
  const received: string[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const raw of barcodes) {
    const line = byCode.get(raw.toUpperCase());
    if (!line) throw Object.assign(new Error(`Unknown barcode for this transfer: ${raw}`), { code: "VALIDATION" });
    if (line.status === "RECEIVED") { skipped.push(line.barcode); continue; }
    if (line.status !== "IN_TRANSIT") throw Object.assign(new Error(`Line not in transit: ${line.barcode}`), { code: "CONFLICT" });
    const p = await db.prepare("SELECT net_mg FROM products WHERE id = ?").bind(line.productId).first<{ net_mg: number }>();
    stmts.push(
      db.prepare("UPDATE products SET status = 'IN_STOCK', branch_id = ? WHERE id = ?").bind(doc.toBranchId, line.productId),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'TRANSFER_IN', 'TRANSFER_PENDING', 'IN_STOCK', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), line.productId, doc.fromBranchId, doc.toBranchId, p?.net_mg ?? 0, `Transfer ${doc.number} received`, now, actorId),
      db.prepare("UPDATE transfer_lines SET status = 'RECEIVED' WHERE id = ?").bind(line.id)
    );
    line.status = "RECEIVED";
    received.push(line.barcode);
  }
  const next = deriveStatus(doc.lines);
  stmts.push(
    db.prepare("UPDATE transfers SET status = ? WHERE id = ?").bind(next, id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.receive", entity: "transfer", entityId: id, next: { received } })
  );
  await db.batch(stmts);
  return { received, skipped };
}

export async function recallLines(db: D1Database, id: string, productIds: string[], actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (!["DISPATCHED", "PARTIAL"].includes(doc.status)) throw Object.assign(new Error("Transfer not dispatched"), { code: "CONFLICT" });
  const byId = new Map(doc.lines.map((l) => [l.productId, l]));
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const pid of productIds) {
    const line = byId.get(pid);
    if (!line || line.status !== "IN_TRANSIT") throw Object.assign(new Error(`Line not recallable: ${pid}`), { code: "CONFLICT" });
    const p = await db.prepare("SELECT net_mg FROM products WHERE id = ?").bind(pid).first<{ net_mg: number }>();
    stmts.push(
      db.prepare("UPDATE products SET status = 'IN_STOCK' WHERE id = ?").bind(pid),
      db.prepare("INSERT INTO stock_movements (id, product_id, type, from_status, to_status, from_branch, to_branch, weight_mg, reason, created_at, created_by) VALUES (?, ?, 'TRANSFER_IN', 'TRANSFER_PENDING', 'IN_STOCK', ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), pid, doc.fromBranchId, doc.fromBranchId, p?.net_mg ?? 0, `Transfer ${doc.number} recalled`, now, actorId),
      db.prepare("UPDATE transfer_lines SET status = 'RECALLED' WHERE id = ?").bind(line.id)
    );
    line.status = "RECALLED";
  }
  const next = deriveStatus(doc.lines);
  stmts.push(
    db.prepare("UPDATE transfers SET status = ? WHERE id = ?").bind(next, id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.recall", entity: "transfer", entityId: id })
  );
  await db.batch(stmts);
}

export async function cancelTransfer(db: D1Database, id: string, reason: string, actorId: string): Promise<void> {
  const doc = await loadTransfer(db, id);
  if (!["REQUESTED", "APPROVED"].includes(doc.status)) throw Object.assign(new Error("Only undispatched transfers can be cancelled; recall lines instead"), { code: "CONFLICT" });
  await db.batch([
    db.prepare("UPDATE transfers SET status = 'CANCELLED' WHERE id = ?").bind(id),
    buildAuditStmt(db, { userId: actorId, action: "transfer.cancel", entity: "transfer", entityId: id, reason }),
  ]);
}
```

Gold rows are written at dispatch only (source sender, destination receiver); receive/recall write stock movements only. Recall keeps `branch_id` at the sender (it never left) and writes TRANSFER_IN sender→sender so the movement ledger pairs every TRANSFER_OUT.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS. (If `postGoldStmts` GoldEntry type mismatches — compare against `gold.ts:24-37` and adjust the local `goldEntries` annotation to `GoldEntry[]` by importing the type.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/transfers.ts
git commit -m "feat: transfer dispatch receive recall cancel"
```

### Task 4: Transfer reconciliation

**Files:**
- Modify: `apps/api/src/services/transfers.ts` (append)

**Interfaces:**
- Consumes: `loadTransfer` from Task 2 (same file).
- Produces: `reconcileTransfer(db, id): Promise<{ passed: boolean; warnings: string[] }>` consumed by Task 5's reconcile route.

- [ ] **Step 1: Append the reconcile function**

```ts
export async function reconcileTransfer(db: D1Database, id: string): Promise<{ passed: boolean; warnings: string[] }> {
  const doc = await loadTransfer(db, id);
  const warnings: string[] = [];
  for (const line of doc.lines) {
    const outs = await db.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ? AND type = 'TRANSFER_OUT' AND ref_check IS NULL AND reason LIKE ?").bind(line.productId, `%Transfer ${doc.number}%`).first<{ n: number }>().catch(() => ({ n: -1 }));
    void outs;
    const { results: moves } = await db.prepare("SELECT type, from_status, to_status FROM stock_movements WHERE product_id = ? AND reason LIKE ?").bind(line.productId, `%Transfer ${doc.number}%`).all<{ type: string; from_status: string; to_status: string }>();
    const outCount = (moves ?? []).filter((m) => m.type === "TRANSFER_OUT").length;
    const inCount = (moves ?? []).filter((m) => m.type === "TRANSFER_IN").length;
    if (outCount !== 1) warnings.push(`${line.barcode}: expected 1 TRANSFER_OUT, found ${outCount}`);
    if (line.status === "RECEIVED" && inCount !== 1) warnings.push(`${line.barcode}: RECEIVED without exactly 1 TRANSFER_IN`);
    if (line.status === "IN_TRANSIT" && inCount !== 0) warnings.push(`${line.barcode}: IN_TRANSIT with premature TRANSFER_IN`);
    const prod = await db.prepare("SELECT status, branch_id, barcode FROM products WHERE id = ?").bind(line.productId).first<{ status: string; branch_id: string; barcode: string }>();
    if (!prod) warnings.push(`${line.barcode}: product row missing`);
    else {
      if (prod.barcode !== line.barcode) warnings.push(`${line.barcode}: barcode changed on product row`);
      if (line.status === "RECEIVED" && (prod.status !== "IN_STOCK" || prod.branch_id !== doc.toBranchId)) warnings.push(`${line.barcode}: RECEIVED but not IN_STOCK at receiver`);
      if (line.status === "IN_TRANSIT" && (prod.status !== "TRANSFER_PENDING" || prod.branch_id !== doc.fromBranchId)) warnings.push(`${line.barcode}: IN_TRANSIT but not TRANSFER_PENDING at sender`);
    }
    const gold = await db.prepare("SELECT COUNT(*) AS n FROM gold_ledger WHERE ref_entity = 'transfer_line' AND ref_id = ?").bind(line.id).first<{ n: number }>();
    if (line.status !== "PENDING" && (gold?.n ?? 0) !== 1) warnings.push(`${line.barcode}: expected 1 gold TRANSFER row, found ${gold?.n ?? 0}`);
    if (line.status === "PENDING" && (gold?.n ?? 0) !== 0) warnings.push(`${line.barcode}: PENDING line with gold movement`);
  }
  return { passed: warnings.length === 0, warnings };
}
```

Delete the dead `outs` query (first statement in the loop with `ref_check IS NULL` and `.catch`) before committing — `stock_movements` has no `ref_check` column and the result is voided. The `moves` query below it is the real check. The final committed loop body starts at `const { results: moves }`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/transfers.ts
git commit -m "feat: transfer reconciliation with warnings"
```

### Task 5: Transfer routes + legacy guard + registration

**Files:**
- Create: `apps/api/src/routes/transfers.ts`
- Modify: `apps/api/src/app.ts` (import + `app.route("/api/v1/transfers", stockTransferRoutes)`)
- Modify: `packages/shared/src/schemas.ts` (append `requestTransferSchema`)
- Modify: `apps/api/src/services/inventory.ts` (cross-branch instant-transfer guard in `recordMovement`'s TRANSFER_PENDING branch)

**Interfaces:**
- Consumes: `requestTransfer, approveTransfer, dispatchTransfer, receiveLines, recallLines, cancelTransfer, reconcileTransfer, loadTransfer` from Tasks 2–4; `PERMISSIONS.PRODUCTS_VIEW/EDIT/CANCEL, BRANCHES_MANAGE`.
- Produces: `GET /transfers`, `POST /transfers`, `GET /transfers/:id`, `POST /transfers/:id/approve`, `POST /transfers/:id/dispatch`, `POST /transfers/:id/receive`, `POST /transfers/:id/recall`, `POST /transfers/:id/cancel`, `GET /transfers/:id/reconcile`. Name the Hono export `stockTransferRoutes` (the `stockTransfers` drizzle model from Task 1 already takes the obvious name).

- [ ] **Step 1: Append shared schema**

```ts
export const requestTransferSchema = z.object({
  fromBranchId: z.string().min(1),
  toBranchId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().max(500).optional(),
});
export type RequestTransferInput = z.infer<typeof requestTransferSchema>;
```

Append to `packages/shared/src/schemas.ts`.

- [ ] **Step 2: Write the routes file**

```ts
import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS, requestTransferSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { approveTransfer, cancelTransfer, dispatchTransfer, loadTransfer, receiveLines, recallLines, reconcileTransfer, requestTransfer } from "../services/transfers";
import { serviceError } from "./http";

const approveSchema = z.object({ approvedBy: z.string().min(1) });
const receiveSchema = z.object({ barcodes: z.array(z.string().min(1).max(32)).min(1).max(100) });
const recallSchema = z.object({ productIds: z.array(z.string().min(1)).min(1).max(100) });
const reasonSchema = z.object({ reason: z.string().min(1).max(500) });

export const stockTransferRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const from = c.req.query("fromBranchId") ?? undefined;
    const to = c.req.query("toBranchId") ?? undefined;
    const status = c.req.query("status") ?? undefined;
    const perms = c.get("permissions") as string[];
    if ((!from && !to) && !perms.includes(PERMISSIONS.BRANCHES_MANAGE))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "fromBranchId or toBranchId required without branches:manage" } }, 403);
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (from) { conds.push("from_branch_id = ?"); vals.push(from); }
    if (to) { conds.push("to_branch_id = ?"); vals.push(to); }
    if (status) { conds.push("status = ?"); vals.push(status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { results } = await c.env.DB.prepare(`SELECT id, number, from_branch_id, to_branch_id, status, requested_by, created_at FROM transfers ${where} ORDER BY created_at DESC LIMIT 50`).bind(...vals).all();
    return c.json({ success: true, data: results ?? [] }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = requestTransferSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid transfer" } }, 400);
    try {
      const data = await requestTransfer(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await loadTransfer(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/approve", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
    const parsed = approveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "approvedBy required" } }, 400);
    try {
      await approveTransfer(c.env.DB, c.req.param("id"), parsed.data.approvedBy, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/dispatch", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    try {
      await dispatchTransfer(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/receive", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = receiveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "barcodes required" } }, 400);
    try {
      const data = await receiveLines(c.env.DB, c.req.param("id"), parsed.data.barcodes, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/recall", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = recallSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "productIds required" } }, 400);
    try {
      await recallLines(c.env.DB, c.req.param("id"), parsed.data.productIds, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = reasonSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    try {
      await cancelTransfer(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/reconcile", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await reconcileTransfer(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  });
```

- [ ] **Step 3: Legacy cross-branch guard**

In `apps/api/src/services/inventory.ts`, inside `recordMovement`'s `if (input.toStatus === "TRANSFER_PENDING")` branch, after the destination-branch lookup and before any batch write, insert:

```ts
if (input.toBranchId !== prev.branch_id)
  throw Object.assign(new Error("Cross-branch transfers must go through POST /transfers"), { code: "CONFLICT" });
```

Use `prev.branch_id` (already loaded in that branch). Same-branch instant transfers keep existing behavior unchanged.

- [ ] **Step 4: Register in app.ts + typecheck**

Add `import { stockTransferRoutes } from "./routes/transfers";` and `app.route("/api/v1/transfers", stockTransferRoutes);`. Run: `pnpm --filter goldos-api exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/routes/transfers.ts apps/api/src/app.ts apps/api/src/services/inventory.ts
git commit -m "feat: transfer document routes with legacy guard"
```

### Task 6: Transfer tests

**Files:**
- Create: `apps/api/src/services/transfers.test.ts`

**Interfaces:**
- Consumes: `deriveStatus` (Task 2, pure — no DB needed); `approveTransfer` guard shape (Task 2).
- Produces: green suite proving state derivation, second-person rule, and duplicate/limit validation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { deriveStatus } from "./transfers";

describe("transfer document", () => {
  it("derives header status from line states", () => {
    expect(deriveStatus([{ status: "PENDING" }, { status: "PENDING" }])).toBe("REQUESTED");
    expect(deriveStatus([{ status: "IN_TRANSIT" }])).toBe("DISPATCHED");
    expect(deriveStatus([{ status: "RECEIVED" }, { status: "IN_TRANSIT" }])).toBe("PARTIAL");
    expect(deriveStatus([{ status: "RECEIVED" }, { status: "RECALLED" }])).toBe("COMPLETE");
  });
  it("refuses approval by the requester without touching stock", async () => {
    const { approveTransfer } = await import("./transfers");
    const db = {
      batch: async (..._a: unknown[]) => {},
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM transfers")) return { id: "t1", number: "TRF-000001", from_branch_id: "b1", to_branch_id: "b2", status: "REQUESTED", reason: null, requested_by: "u1", approved_by: null };
            return null;
          },
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;
    await expect(approveTransfer(db, "t1", "u1", "u9")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects duplicate products at request validation", async () => {
    const { requestTransfer } = await import("./transfers");
    await expect(requestTransfer({} as D1Database, { fromBranchId: "b1", toBranchId: "b2", productIds: ["p1", "p1"] }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
```

The `loadTransfer` fake returns the header with `requested_by: "u1"` so the self-approval guard (`approverId === doc.requestedBy`) fires before any stock query. The duplicate test fires before any query.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/transfers.test.ts`
Expected: FAIL with "Cannot find module './transfers'" (Tasks 2–4 not yet implemented when following task-by-task; if implementing in order this fails first, then passes after Task 2).

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/services/transfers.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 4: Run full suite**

Run: `pnpm --filter goldos-api exec vitest run`
Expected: PASS — 10 files, no regressions in `counts`, `monthly`, `dayclose`, `journal`, `reconcile` suites.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/transfers.test.ts
git commit -m "test: transfer status derivation and approval guards"
```

## Self-Review

- Spec §2 (schema): Task 1 — tables, indexes, TRF counter, `stockTransfers`/`transferLines` names avoiding the route-export collision. Covered.
- Spec §3 (transitions): Tasks 2–3 + 5 — request/approve/dispatch/receive/recall/cancel with exact perms, second-person + sending-branch-membership checks, `assertCountLock` on request and dispatch, one-batch dispatch, idempotent re-receive, 409 legacy guard. Covered.
- Spec §4 (gold/money): Tasks 3–4 — one gold TRANSFER row per line at dispatch via `postGoldStmts`; no journal; reconciliation checks movement counts, branch/status agreement, barcode stability, gold-row parity. Covered.
- Spec §5 (lock/count): Task 3/5 — TRANSFER_PENDING unsellable/uncounted by existing filters; dispatch calls `assertCountLock`. Covered.
- Spec §6 (branch scoping): Task 5 — branch filter required without `branches:manage`. Covered.
- Spec §7 (no-fabrication): Tasks 3–4 — unscanned lines stay IN_TRANSIT; PARTIAL explicit; recall visible. Covered.
- Spec §8 (testing): Task 6 — state derivation, guards, validation; seeded-DB ledger tests noted as hardening for the executing pass if cheap, not a gap.
- Placeholder scan: no TBD/TODO; the Task 3 double-import note and Task 4 dead-query note are explicit do/don't instructions, not placeholders.
- Type consistency: `loadTransfer → TransferDoc`, `deriveStatus(lines) → string`, `receiveLines → { received, skipped }`, `reconcileTransfer → { passed, warnings }` used identically across Tasks 2–6; `buildAuditStmt(db, entry)` two-arg form everywhere.

## Following slices (separate specs → plans)

- Slice 3 — Missing-item / discrepancy reports (feeds on IN_TRANSIT leftovers, count compare outputs).
- Slice 4 — Branch-stock consolidated read view.
- Monthly Slices 2–3 — aging + valuation, then CSV exports + dashboard.
