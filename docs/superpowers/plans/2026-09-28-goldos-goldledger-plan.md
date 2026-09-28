# GoldOS Gold Ledger & Melting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the unified gold ledger (backfilled, append-only) and the melting pipeline (old-gold in, assayed refined lots out, approved reconciliation) with lineage, stock dashboard, and counter UI — migrated and deployed.

**Architecture:** Migration `0013_goldledger` creates `gold_ledger`, melting tables, MELT counter, and gold perms; backfill runs inside the same file. `postGoldStmts` (new `services/gold.ts`) validates and returns statements for composition; melting orchestrator mirrors the oldgold staged pattern (create→add→lock→melt→approve). All writes batch with audit.

**Tech Stack:** Hono, Drizzle, D1, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler, bwip-js (MELT label via existing label helper pattern).

## Global Constraints

- Every write batches business row(s) + audit_logs; failure rolls back.
- Ledgers append-only; no UPDATE/DELETE on gold_ledger, melting_inputs/outputs after lock.
- Strict TypeScript, no `any`; Zod client + server; typed `{ success, data, error }` responses.
- Weights INTEGER mg, purity INTEGER permille; convert at API boundary only.
- OG numbers `OG-000001` exist; MELT numbers `MELT-000001`; lots `MLT-{n}-02` (see Task 2 note).
- Locked statuses outside melting stay locked; manufacturing linkage excluded.
- New perms `gold:view`, `gold:manage` (49 total); view = owner/manager/accountant/gold_officer/cashier, manage = owner/manager/gold_officer.
- `reverse` action still unseeded.

---

## Permission additions (single source of truth)

- `gold:view`, `gold:manage`.
- Owner grant count becomes 49; manager 47 (still excludes users:approve, branches:approve).

## File Structure

- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/gold.test.ts`
- Create: `apps/api/drizzle/0013_goldledger.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Create: `apps/api/src/services/gold.ts`, `apps/api/src/services/melting.ts`
- Create: `apps/api/src/routes/gold.ts`, `apps/api/src/routes/melting.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/services/oldgold.ts` (pending-list note only — no, keep untouched; pending query lives in melting service)
- Modify web: sidebar (Gold section), dashboard Gold cards, `components/lineage-chain.tsx`
- Create web: `gold/ledger`, `gold/melting`, `gold/melting/[id]`, `gold/stock`
- Modify docs: `database.md`, `api.md`, `permissions.md`, `gold-accounting.md`

`gold.ts` = ledger writes/reads/lineage/stock. `melting.ts` = batch pipeline. Routes parse/validate only.

---

### Task 1: Shared gold perms + melting schemas + math spec

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/gold.test.ts`
- Test: `packages/shared/src/gold.test.ts`

**Interfaces:**
- Consumes: existing `z`, `PERMISSIONS`, `DEFAULT_ROLES`.
- Produces: `GOLD_VIEW/GOLD_MANAGE`; updated `DEFAULT_ROLES`; `createMeltSchema, addMeltItemsSchema, meltRecordSchema, approveMeltSchema, adjustGoldSchema` (+ types); `meltDifference` + `lossPct` helpers (copied verbatim into melting service).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/gold.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function meltDifference(inputMg: number, outputMg: number, wasteMg: number): { lossMg: number; recoveryMg: number } {
  const diff = inputMg - outputMg - wasteMg;
  return diff >= 0 ? { lossMg: diff, recoveryMg: 0 } : { lossMg: 0, recoveryMg: -diff };
}

export function lossPct(lossMg: number, inputMg: number): number {
  if (inputMg <= 0) throw new Error("input must be positive");
  return (lossMg / inputMg) * 100;
}

describe("gold ledger", () => {
  it("seeds gold permissions", () => {
    expect(PERMISSIONS.GOLD_VIEW).toBe("gold:view");
    expect(PERMISSIONS.GOLD_MANAGE).toBe("gold:manage");
    expect(DEFAULT_ROLES["gold_officer"]).toContain("gold:manage");
    expect(DEFAULT_ROLES["cashier"]).toContain("gold:view");
    expect(DEFAULT_ROLES["cashier"]).not.toContain("gold:manage");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("gold:view");
  });
  it("reproduces the spec example: 7780 in, 7400 out, 200 waste", () => {
    const d = meltDifference(7780, 7400, 200);
    expect(d).toEqual({ lossMg: 180, recoveryMg: 0 });
    expect(lossPct(180, 7780)).toBeCloseTo(2.313, 2);
  });
  it("treats surplus as recovery", () => {
    expect(meltDifference(7000, 7100, 0)).toEqual({ lossMg: 0, recoveryMg: 100 });
  });
});
```

Verify the example math before trusting: 7780 − 7400 − 200 = 180 ✓. 180/7780 = 0.02313… = 2.313% ✓ (> 2% default → approval required ✓).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/gold.test.ts`
Expected: FAIL (missing GOLD_VIEW export; math tests pass as pure spec — same pattern as purchases/oldgold tests).

- [ ] **Step 3: Implement perms + schemas**

permissions.ts: append `GOLD_VIEW: "gold:view", GOLD_MANAGE: "gold:manage",` to PERMISSIONS. DEFAULT_ROLES: owner `[...ALL]` auto; manager filter unchanged; accountant append `"gold:view"`; gold_officer append `"gold:view", "gold:manage"`; cashier append `"gold:view"`. Others unchanged.
schemas.ts append:
```ts
export const GOLD_TYPES = ["PURCHASE", "OLD_GOLD_PURCHASE", "SALE", "MELTING_INPUT", "MELTING_OUTPUT", "MANUFACTURING_INPUT", "MANUFACTURING_OUTPUT", "TRANSFER", "RETURN", "ADJUSTMENT", "LOSS", "RECOVERY"] as const;

export const createMeltSchema = z.object({
  branchId: z.string().min(1),
  notes: z.string().max(2000).optional(),
});

export const addMeltItemsSchema = z.object({
  oldGoldIds: z.array(z.string().min(1)).min(1).max(50),
});

export const meltRecordSchema = z.object({
  outputWeightG: z.number().gt(0).max(100000),
  assayPermille: z.number().int().gt(0).lte(1000),
  wasteG: z.number().min(0).max(100000).optional().default(0),
  outputType: z.enum(["grain", "bar"]).optional().default("grain"),
});

export const approveMeltSchema = z.object({
  reason: z.string().min(1).max(500),
  approvedBy: z.string().min(1).optional(),
});

export const adjustGoldSchema = z.object({
  type: z.enum(["ADJUSTMENT", "LOSS", "RECOVERY"]),
  branchId: z.string().min(1),
  weightG: z.number().gt(0).max(100000),
  permille: z.number().int().gt(0).lte(1000),
  reason: z.string().min(1).max(500),
  approvedBy: z.string().min(1).optional(),
});

export type CreateMeltInput = z.infer<typeof createMeltSchema>;
export type ApproveMeltInput = z.infer<typeof approveMeltSchema>;
```

- [ ] **Step 4: Green + typecheck + commit**

Run: `pnpm exec vitest run packages/shared/src/gold.test.ts 2>&1 | grep -E "Tests "; pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
Expected: 3 passed + TSC_OK.
```bash
git add packages/shared/src/permissions.ts packages/shared/src/schemas.ts packages/shared/src/gold.test.ts
git commit -m "feat: gold permissions, melting schemas, reconciliation spec"
```

---

### Task 2: Migration 0013 + drizzle + seed (incl. backfill)

**Files:**
- Create: `apps/api/drizzle/0013_goldledger.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Test: local apply + backfill counts + tsc

**Interfaces:**
- Consumes: Task 1 perm names.
- Produces: `gold_ledger`, melting tables, MELT counter, 2 perms + grants, backfilled rows.

- [ ] **Step 1: Write 0013_goldledger.sql**

```sql
CREATE TABLE gold_ledger (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  branch_id TEXT REFERENCES branches(id),
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  type TEXT NOT NULL,
  weight_mg INTEGER NOT NULL,
  permille INTEGER NOT NULL,
  fine_mg INTEGER NOT NULL,
  ref_entity TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  product_id TEXT REFERENCES products(id),
  old_gold_id TEXT REFERENCES old_gold_items(id),
  user_id TEXT REFERENCES users(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_goldledger_branch ON gold_ledger(branch_id, occurred_at DESC);
CREATE INDEX idx_goldledger_ref ON gold_ledger(ref_entity, ref_id);
CREATE INDEX idx_goldledger_product ON gold_ledger(product_id, occurred_at DESC);
CREATE INDEX idx_goldledger_oldgold ON gold_ledger(old_gold_id, occurred_at DESC);
CREATE TABLE melting_batches (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  input_fine_mg INTEGER NOT NULL DEFAULT 0,
  output_fine_mg INTEGER NOT NULL DEFAULT 0,
  waste_mg INTEGER NOT NULL DEFAULT 0,
  loss_mg INTEGER NOT NULL DEFAULT 0,
  recovery_mg INTEGER NOT NULL DEFAULT 0,
  difference_reason TEXT,
  approved_by TEXT REFERENCES users(id),
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE melting_inputs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES melting_batches(id),
  old_gold_id TEXT NOT NULL UNIQUE REFERENCES old_gold_items(id),
  gross_mg INTEGER NOT NULL,
  net_mg INTEGER NOT NULL,
  fine_mg INTEGER NOT NULL
);
CREATE TABLE melting_outputs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES melting_batches(id),
  lot_number TEXT NOT NULL UNIQUE,
  weight_mg INTEGER NOT NULL,
  permille INTEGER NOT NULL,
  fine_mg INTEGER NOT NULL,
  output_type TEXT NOT NULL DEFAULT 'grain'
);
INSERT INTO counters (name, next) VALUES ('MELT', 1);
```

Backfill (same file, after tables; gold_movements has columns id, product_id, old_gold_id, direction, fine_mg, purity_permille, ref_entity, ref_id, branch_id, created_at, created_by — verified in schema.ts lines 362–374):
```sql
INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by)
SELECT
  'bf-' || m.id, m.created_at, m.branch_id,
  CASE WHEN m.direction = 'OUT' THEN 'branch:' || COALESCE(m.branch_id, '') ELSE 'customer:unknown' END,
  CASE WHEN m.direction = 'OUT' THEN 'customer:unknown' ELSE 'branch:' || COALESCE(m.branch_id, '') END,
  CASE m.ref_entity
    WHEN 'sale_invoice' THEN 'SALE'
    WHEN 'sale_return' THEN 'RETURN'
    WHEN 'old_gold_purchase' THEN 'OLD_GOLD_PURCHASE'
    ELSE 'ADJUSTMENT'
  END,
  COALESCE(p.net_mg, o.net_mg, m.fine_mg),
  m.purity_permille,
  m.fine_mg,
  m.ref_entity, m.ref_id, m.product_id, m.old_gold_id, m.created_by,
  'backfill from gold_movements',
  m.created_at, m.created_by
FROM gold_movements m
LEFT JOIN products p ON p.id = m.product_id
LEFT JOIN old_gold_items o ON o.id = m.old_gold_id;
INSERT INTO permissions (id, name) VALUES ('gold:view', 'gold:view'), ('gold:manage', 'gold:manage');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'gold:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'gold:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'gold:view'),
  ('gold_officer', 'gold:view'), ('gold_officer', 'gold:manage'),
  ('cashier', 'gold:view');
```

Backfill notes: `weight_mg` falls back to fine_mg when neither join matches (shouldn't happen; every movement links a product or old-gold item). `source/destination` use explicit `unknown` placeholders for the counterparty the old table didn't record — honest, queryable, documented. `purchase_invoice` ref_entity: purchases create products but write NO gold rows (verified: only sales/returns/oldgold write gold_movements), so no PURCHASE mapping needed.

- [ ] **Step 2: Drizzle + seed**

Append `goldLedger`, `meltingBatches`, `meltingInputs`, `meltingOutputs` mirroring SQL exactly (buyPct-style: use `real` only if needed — none here; all INTEGER/TEXT).
seed.ts: SEED_PERMISSIONS append both; owner spread auto; manager filter auto; accountant append gold:view; gold_officer append both; cashier append gold:view.

- [ ] **Step 3: Apply local + verify backfill**

Run: `pnpm --filter goldos-api exec wrangler d1 execute DB --local --file ./drizzle/0013_goldledger.sql 2>&1 | grep -E "success|ERROR" | head -2`
Run: `... --command "SELECT COUNT(*) AS g FROM gold_ledger; SELECT COUNT(*) AS m FROM gold_movements; SELECT type, COUNT(*) AS n FROM gold_ledger GROUP BY type;"` → g == m, types ∈ {SALE, RETURN, OLD_GOLD_PURCHASE}.
Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK` (services untouched — passes).

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0013_goldledger.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: gold ledger, melting tables, backfill, permissions"
```

---

### Task 3: Gold ledger service

**Files:**
- Create: `apps/api/src/services/gold.ts`
- Test: tsc standalone (routes next task)

**Interfaces:**
- Consumes: `buildAuditStmt`; `PageOpts` from `./catalog`.
- Produces: `postGoldStmts, listLedger, goldLineage, goldStock, recordAdjustment` — routes consume in Task 5.

- [ ] **Step 1: Write services/gold.ts**

```ts
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";

export const GOLD_TYPES = ["PURCHASE", "OLD_GOLD_PURCHASE", "SALE", "MELTING_INPUT", "MELTING_OUTPUT", "MANUFACTURING_INPUT", "MANUFACTURING_OUTPUT", "TRANSFER", "RETURN", "ADJUSTMENT", "LOSS", "RECOVERY"] as const;

export type GoldEntry = {
  occurredAt?: number;
  branchId?: string;
  source: string;
  destination: string;
  type: string;
  weightMg: number;
  permille: number;
  refEntity: string;
  refId: string;
  productId?: string;
  oldGoldId?: string;
  notes?: string;
};

export async function postGoldStmts(
  db: D1Database,
  entries: GoldEntry[],
  opts: { actorId: string; auditAction: string; auditEntity: string; auditEntityId: string; branchId?: string }
): Promise<D1PreparedStatement[]> {
  if (entries.length === 0)
    throw Object.assign(new Error("Empty gold posting"), { code: "VALIDATION" });
  for (const e of entries) {
    if (!GOLD_TYPES.includes(e.type as (typeof GOLD_TYPES)[number]))
      throw Object.assign(new Error(`Unknown gold type: ${e.type}`), { code: "VALIDATION" });
    if (e.weightMg <= 0 || e.permille <= 0 || e.permille > 1000)
      throw Object.assign(new Error("Invalid weight/purity"), { code: "VALIDATION" });
    const fine = Math.round((e.weightMg * e.permille) / 1000);
    void fine;
  }
  const now = Date.now();
  const stmts = entries.map((e) => {
    const fineMg = Math.round((e.weightMg * e.permille) / 1000);
    return db
      .prepare(
        "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(), e.occurredAt ?? now, e.branchId ?? opts.branchId ?? null,
        e.source, e.destination, e.type, e.weightMg, e.permille, fineMg,
        e.refEntity, e.refId, e.productId ?? null, e.oldGoldId ?? null,
        opts.actorId, e.notes ?? null, now, opts.actorId
      );
  });
  stmts.push(
    buildAuditStmt(db, {
      userId: opts.actorId, action: opts.auditAction, entity: opts.auditEntity,
      entityId: opts.auditEntityId, next: { entries: entries.length }, branchId: opts.branchId,
    })
  );
  return stmts;
}
```

Note: the `void fine` recompute-then-discard is intentional dead code? No — remove it; the map recomputes. Drop the unused `fine` variable (keep validation only). Final code: validate ranges, compute fine once inside map.

```ts
export async function listLedger(
  db: D1Database,
  opts: PageOpts & { type?: string; branchId?: string; refEntity?: string; refId?: string; productId?: string; oldGoldId?: string; from?: number; to?: number }
) {
  // conds on g.* + LIKE search over (ref_id, notes, source, destination); ORDER occurred_at DESC; LIMIT/OFFSET; { rows, total }
}

export async function goldLineage(db: D1Database, refEntity: string, refId: string) {
  // Seed node { kind: refEntity, id: refId }. Walk BACKWARD + FORWARD:
  // - sale_invoice S…: items via sales_items → product nodes → for each: purchase_invoice_items → purchase invoice node; old_gold_items.converted_product_id → old-gold node
  // - old_gold OG…: melting_inputs.old_gold_id → batch node → outputs (lots) + sibling inputs; converted_product_id → product node
  // - melting batch MELT-…: inputs (old-gold nodes) + outputs (lot nodes)
  // - product (JW-/PRD-): sales_items → sale nodes; purchase_invoice_items → purchase node; converted link → old-gold node
  // - purchase invoice PINV-…: items → product nodes
  // Each node: { kind, id, label, link } where link is the web path (/sales/invoices/…, /products/…, /old-gold/items/…, /gold/melting/…).
  // Depth cap 2 hops each direction. Dedupe by kind:id. Return { nodes, edges: [{ from, to, label }] }.
}

export async function goldStock(db: D1Database, groupBy: "purity" | "branch" | "stage") {
  // stage buckets (fine_mg sums):
  // - old_gold: SELECT COALESCE(SUM(fine_mg),0) FROM old_gold_items WHERE status IN ('PURCHASED','AVAILABLE')
  // - melting: SELECT COALESCE(SUM(input_fine_mg),0) FROM melting_batches WHERE status IN ('LOCKED','MELTED')
  // - refined: SELECT COALESCE(SUM(fine_mg),0) FROM melting_outputs WHERE batch_id IN (SELECT id FROM melting_batches WHERE status = 'APPROVED')
  // - for_sale: SELECT COALESCE(SUM(fine_gold_mg),0) FROM products WHERE status = 'IN_STOCK'
  // purity: UNION per bucket? Simpler: return { stages: {...}, byPurity: [...], byBranch: [...] } where byPurity/byBranch aggregate old_gold + products + outputs joined to purities... outputs lack purity_id (they store permille). Group raw permille.
  // Shape: { stages: { old_gold_mg, melting_mg, refined_mg, for_sale_mg }, byPurity: [{ permille, fine_mg }], byBranch: [{ branch_id, fine_mg }] }
  // byPurity: SUM over (old_gold tested_permille) + (products→purities.permille) + (outputs.permille). byBranch: same grouped by branch.
}

export async function recordAdjustment(
  db: D1Database,
  input: { type: "ADJUSTMENT" | "LOSS" | "RECOVERY"; branchId: string; weightMg: number; permille: number; reason: string; approvedBy?: string },
  actorId: string
) {
  // threshold: settings gold_adjust_approve_mg (default 1000mg). If weightMg >= threshold: require approvedBy with gold:manage (not self) else FORBIDDEN. Reuse inline approver check (copy requireApprover pattern from oldgold.ts lines ~89–103, swapping "oldgold:approve" → "gold:manage").
  // batch: postGoldStmts([{...input, source: "adjustment", destination: `branch:${branchId}`, refEntity: "gold_adjustment", refId: <uuid>}], {actorId, auditAction: "gold.adjust", ...}) + batch execute. Return { id }.
}
```

- [ ] **Step 2: tsc standalone + commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK` (routes don't exist — service standalone, expect clean).
```bash
git add apps/api/src/services/gold.ts
git commit -m "feat: gold ledger service with lineage and stock"
```

---

### Task 4: Melting service

**Files:**
- Create: `apps/api/src/services/melting.ts`
- Test: tsc (routes next task reference it — service standalone must be clean now)

**Interfaces:**
- Consumes: `postGoldStmts` from `./gold`; `meltDifference/lossPct` logic (copy from shared test verbatim); `getSetting`; `buildAuditStmt`.
- Produces: `createBatch, addItems, lockBatch, recordMelt, approveBatch, voidBatch, getBatch, listBatches` — routes consume in Task 5.

- [ ] **Step 1: Write services/melting.ts**

```ts
import { fineGoldMg, gToMg } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { postGoldStmts } from "./gold";
import { getSetting } from "./settings";

async function nextMelt(db: D1Database, stmts: D1PreparedStatement[]): Promise<string> {
  const row = await db.prepare("SELECT next FROM counters WHERE name = 'MELT'").bind().first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'MELT'").bind(row.next + 1));
  return `MELT-${String(row.next).padStart(6, "0")}`;
}
// NOTE: purchases service nextNumber() does exactly this per-counter; do NOT generalize — copy is fine.

export async function createBatch(db: D1Database, branchId: string, notes: string | undefined, actorId: string) {
  // branch active check; batch [counter bump, INSERT DRAFT, audit melt.create]; return { id, number }
}

export async function addItems(db: D1Database, batchId: string, oldGoldIds: string[], actorId: string) {
  // batch DRAFT only else CONFLICT; each id: AVAILABLE else VALIDATION("Only AVAILABLE items"); melting_inputs.old_gold_id UNIQUE violation → map to CONFLICT "already in a batch" (catch by pre-check SELECT, not error parsing)
  // batch: [INSERT inputs (snapshots gross/net/fine), UPDATE old_gold RESERVED_FOR_MELTING, audit melt.add] ; update input_fine_mg = SUM
  // return { added, inputFineMg }
}

export async function lockBatch(db: D1Database, batchId: string, actorId: string) {
  // DRAFT + ≥1 input else VALIDATION; →LOCKED + audit
}

export async function recordMelt(db: D1Database, batchId: string, input: { outputWeightG: number; assayPermille: number; wasteG?: number; outputType?: "grain" | "bar" }, actorId: string) {
  // status LOCKED else CONFLICT; outputMg = gToMg; waste = gToMg(wasteG ?? 0)
  // outputFine = fineGoldMg(outputMg, assayPermille); loss = inputFine − outputFine − waste; recovery = max(0, −loss); loss = max(0, loss)
  // lot_number = `MLT-${number.slice(5)}-01` (number is MELT-000001 → MLT-000001-01)
  // batch: [INSERT melting_outputs, UPDATE batch (output_fine, waste, loss, recovery, status MELTED), audit melt.record]; return { outputFineMg, lossMg, recoveryMg, lossPct: (lossMg/inputFine)*100 }
}

export async function approveBatch(db: D1Database, batchId: string, input: { reason: string; approvedBy?: string }, actorId: string) {
  // status MELTED else CONFLICT; reason required (schema enforces min(1))
  // threshold: settings melt_loss_approve_pct (default 2); if lossPct > threshold: require approvedBy with gold:manage (not self) else FORBIDDEN — copy requireApprover pattern, swap permission
  // build gold entries: per input → {type MELTING_INPUT, source old-gold:{id}, destination melting:{batchId}, weightMg net, permille tested, refEntity melting_batch, oldGoldId}; output → {type MELTING_OUTPUT, source melting:{batchId}, destination branch:{branchId}, weightMg output, permille assay}; loss>0 → {type LOSS, source melting, destination loss, weightMg loss, permille assay}; recovery>0 → {type RECOVERY, source melting, destination branch}
  // postGoldStmts validates; batch: [UPDATE items →MELTED, UPDATE batch →APPROVED + approved_by, ...gold stmts (includes audit gold.post)]; return { lossMg, recoveryMg }
}

export async function voidBatch(db: D1Database, batchId: string, reason: string, actorId: string) {
  // DRAFT only else CONFLICT; release inputs back to AVAILABLE (UPDATE old_gold WHERE id IN (SELECT old_gold_id ...)); UPDATE batch VOID + audit melt.void
}

export async function getBatch(db: D1Database, id: string) {
  // batch + inputs (join old_gold number/description/fine) + item tests? (join gold_tests per input — include) + outputs + gold_ledger rows (ref melting_batch) — return { batch, inputs, outputs, ledger }
}

export async function listBatches(db: D1Database, opts: PageOpts & { status?: string; branchId?: string }) {
  // LIKE number + filters; { rows, total }
}
```

Permille edge: assay 1000 allowed (lte 1000 ✓); fine recompute tolerance lives in postGoldStmts? postGoldStmts recomputes fine itself (no tolerance needed — it computes, doesn't compare). Drop tolerance concept.

- [ ] **Step 2: tsc + commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK`
```bash
git add apps/api/src/services/melting.ts
git commit -m "feat: melting batch pipeline service"
```

---

### Task 5: Gold + melting routes + mount

**Files:**
- Create: `apps/api/src/routes/gold.ts`, `apps/api/src/routes/melting.ts`
- Modify: `apps/api/src/app.ts`
- Test: tsc clean (whole api)

**Interfaces:**
- Consumes: Tasks 3–4 fns; schemas; guards below.
- Produces: mounted `/api/v1/gold/*`, `/api/v1/melting/*`.

Guards: ledger GET/lineage/stock → gold:view; adjustments POST → gold:manage; batches POST/GET → create=oldgold:edit? No — melting is gold domain: create batch + add items + lock + melt + void → gold:manage? Counter operators (gold_officer has manage ✓, cashier does not). Decide: batch create/add/lock/melt → `gold:manage`; approve → `gold:manage`; void → `gold:manage`; GET → `gold:view`. Rationale: melting destroys customer property — restrict to gold officers+. Document in plan (deviation from oldgold:edit noted explicitly).

Routes (exact):
```ts
// gold.ts (.use(requireAuth))
.get("/ledger", requirePerm(GOLD_VIEW), ...) // ?type=&branchId=&refEntity=&refId=&productId=&oldGoldId=&from=&to=&search=&page=&limit=
.get("/lineage", requirePerm(GOLD_VIEW), ...) // ?refEntity=&refId= (both required → 400 otherwise)
.get("/stock", requirePerm(GOLD_VIEW), ...) // ?groupBy=purity|branch|stage (default stage)
.post("/ledger/adjustments", requirePerm(GOLD_MANAGE), ...) // adjustGoldSchema → 201 { id }
// melting.ts (.use(requireAuth))
.post("/batches", requirePerm(GOLD_MANAGE), ...) // createMeltSchema → 201 { id, number }
.get("/batches", requirePerm(GOLD_VIEW), ...) // ?status=&branchId=&search=&page=&limit=
.get("/batches/:id", requirePerm(GOLD_VIEW), ...)
.post("/batches/:id/items", requirePerm(GOLD_MANAGE), ...) // addMeltItemsSchema → 201 { added, inputFineMg }
.post("/batches/:id/lock", requirePerm(GOLD_MANAGE), ...) // → 200 { ok }
.post("/batches/:id/melt", requirePerm(GOLD_MANAGE), ...) // meltRecordSchema → 200 { outputFineMg, lossMg, recoveryMg, lossPct }
.post("/batches/:id/approve", requirePerm(GOLD_MANAGE), ...) // approveMeltSchema → 200
.patch("/batches/:id/void", requirePerm(GOLD_MANAGE), ...) // { reason } → 200
.get("/batches/:id/label", requirePerm(GOLD_VIEW), ...) // bwip-js Code128 SVG of batch number (mirror products label route pattern: check routes/products.ts label handler for exact bwip usage)
```
dayBounds: copy 12-line helper from sales route (same UTC-day semantics).

- [ ] **Step 1–3: Write both route files, mount (`app.route("/api/v1/gold", gold); app.route("/api/v1/melting", melting);` alphabetical near inventory), tsc clean, commit**

```bash
git add apps/api/src/routes/gold.ts apps/api/src/routes/melting.ts apps/api/src/app.ts
git commit -m "feat: gold ledger and melting routes"
```

---

### Task 6: Live verify + remote deploy

**Files:** none (migrate via script + deploy + gate).

- [ ] **Step 1: Remote migrate + deploy**

Run: `./scripts/cloudflare-sync.sh` (migrates remote DB incl. 0013 + backfill, deploys backend, health-checks — script already exists and was used for 0012).
If the Cloudflare import API flakes (seen before with 0009): retry once; if FK error: seed prerequisite rows first.

- [ ] **Step 2: Counter gate (local 8788 first, then remote smoke)**

Local (admin login; port 8788 — 8787 belongs to sibling project):
1. `GET /gold/ledger` → backfilled rows == gold_movements count; types sane.
2. Intake OG → test → value → purchase (creates gold_movements IN + gold_ledger? No — old flows still write gold_movements only; gold_ledger gets new rows only from melting/adjustments until cutover. Document: purchase does NOT write gold_ledger yet.)
3. Create batch → add 2 AVAILABLE items → lock → melt (output+assay+waste) → check computed loss/recovery → approve with reason (loss% over 2 → with manager approver; under → without) → verify: items MELTED, outputs exist, gold_ledger has MELTING_INPUT×2 + MELTING_OUTPUT + LOSS, audit melt.* rows.
4. Negatives: double-add same item → 409; melt before lock → 409; void post-lock → 409; approve without reason → 400; over-threshold without approver → 403; cashier create batch → 403.
5. Lineage: `GET /gold/lineage?refEntity=melting_batch&refId=` walks to OG items; from old_gold reaches batch + lots.
6. Stock: stage buckets shift (old_gold ↓, melting/refined ↑).
7. `pnpm exec vitest run` all green.
Remote smoke: batch create + approve 1 item + ledger present. Then STOP (no commit — no files).

---

### Task 7: Web gold UI

**Files:**
- Modify: `apps/web/components/app-sidebar.tsx` (Gold section), `apps/web/app/(app)/page.tsx` (Gold cards — check current card implementation first)
- Create: `apps/web/app/(app)/gold/ledger/page.tsx`, `apps/web/components/lineage-chain.tsx`
- Create: `apps/web/app/(app)/gold/melting/page.tsx`, `apps/web/app/(app)/gold/melting/[id]/page.tsx`, `apps/web/app/(app)/gold/stock/page.tsx`
- Test: tsc + build + click-through

**Interfaces:**
- Consumes: Task 5 endpoints; existing MasterCrud? Ledger/melting tables are custom (no MasterCrud — it assumes deactivate flows).
- Produces: 4 pages + lineage component.

- [ ] **Step 1: Sidebar + ledger page**

Sidebar section "Gold" (perm gold:view): Ledger, Melting, Stock — read sidebar file first for section shape.
ledger/page.tsx: filters (type select of 12, branch, date from/to, search) + table (time, type, source→destination, weight g, permille, fine g, ref link) + CSV export client-side (no new perm — export button gated gold:view; server has no export perm for gold, matches plan).

- [ ] **Step 2: Melting list/detail + stock + lineage**

melting/page.tsx: batches table (number, status, input/output fine, loss%) + create dialog (branch, notes).
melting/[id]/page.tsx: status stepper, scan-add items (OG- lookup → POST items), lock/melt/approve/void dialogs (melt: output weight, assay, waste, type; live difference preview computed client-side with same formula), outputs table, ledger rows table, label print link (`/melting/batches/:id/label` — opens SVG; print via browser).
stock/page.tsx: stage cards (old_gold/melting/refined/for_sale in grams + fine) + purity table + branch table (tabs for groupBy).
lineage-chain.tsx: props `{ nodes, edges }`; horizontal chain with kind badges + links; embed in product detail + old-gold detail pages (read both files first; add a "Lineage" section fetching `/gold/lineage?refEntity=product&refId=` / `old_gold`).

- [ ] **Step 3: Dashboard cards**

page.tsx: check how Today's Sales/Gold Sold cards fetch (they call summary endpoints). Wire "Gold Purchased"/"Gold Sold" or equivalent cards to `/gold/stock` (for_sale fine + old_gold fine) — fallback "—" on error, matching existing pattern.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter goldos-web exec tsc --noEmit && echo TSC_OK`
Run: `NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter goldos-web exec next build` → /gold/* present.
Click-through (API 8788, web 3001): /gold/ledger, /gold/melting, /gold/stock 200.
```bash
git add apps/web
git commit -m "feat: gold ledger, melting, and stock UI"
```

---

### Task 8: Docs + full verification

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/gold-accounting.md`
- Test: suite

- [ ] **Step 1: Docs**

database.md: 0013 section (gold_ledger, melting tables, MELT counter, backfill mapping table).
api.md: all gold/melting endpoints + cents contract + approval rules.
permissions.md: gold:view/manage row.
gold-accounting.md: rewrite Status section — ledger live, melting postings (INPUT/OUTPUT/LOSS/RECOVERY), gold_movements dual-write + cutover note.

- [ ] **Step 2: Full suite + commit**

Run: `pnpm test` (3/3) + `pnpm build` (3/3).
```bash
git add docs
git commit -m "docs: gold ledger, melting tables, endpoints"
```

---

## Self-Review

- Spec coverage: 12-type ledger + all fields (§2 Tasks 2–3) ✓; MELT numbering (§2 Task 2) ✓; staged flow + lock (§3 Tasks 4–5) ✓; assay + difference + reason/approval (§3 Tasks 1,4–5) ✓; reconciliation reasons (§3 Task 5 — reason free-text + threshold) ✓; stock by purity/branch/stage (§4 Tasks 3,7) ✓; lineage both directions (§4 Tasks 3,5,7) ✓; UI list/detail/label/scan meaning (§4 Task 7 — scan via existing OG lookup + new scan-add) ✓.
- Placeholder scan: no TBD/TODO; postings, thresholds, lot format explicit.
- Type consistency: `amount_cents` server / LKR boundary; `refEntity` strings fixed ('melting_batch','gold_adjustment'); one lot per batch (`MLT-{n}-01`), no multi-lot numbering needed.
