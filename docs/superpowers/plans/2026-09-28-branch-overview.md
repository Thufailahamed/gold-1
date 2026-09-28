# Branch Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-branch consolidated read view and the manage-only all-branches array with a structural no-mix guarantee.

**Architecture:** Small refactor in `reconcile.ts` (`heldGoldStages` export, `heldGoldMg` reuses it byte-identical); new read-only service `apps/api/src/services/overview.ts` composing `heldGoldStages`, `accountBalance`, `listBankAccounts`, `buildMonthlyReport`, and direct staff/stock/transit queries; routes `apps/api/src/routes/overview.ts` as `/api/v1/branch-overview`. No migration, no writes.

**Tech Stack:** Hono 4 on Cloudflare Workers, Drizzle ORM → D1 (SQLite), Zod 3 (query validation inline), Vitest 2, TypeScript 5.5 strict (no `any`).

## Global Constraints

- Read-only: no INSERT/UPDATE/DELETE in this feature; no migration.
- Money in INTEGER cents exact; gold in INTEGER fine milligrams exact with 0 tolerance.
- Jewellery values book `cost_cents`, never board rate; weights exact mg.
- The all-branches response is an array with no `total` key; no code path sums across branches.
- In-transit stock/cash appear only under `transit`, never in shelf/drawer figures.
- Stock/cash/gold carry `asOf` (live snapshot); sales/purchases carry the month window.
- Single view needs membership or `branches:manage`; `/all` needs `branches:manage`; CSV per-branch only needs `audit:export` with live-read preamble.

---

### Task 1: heldGoldStages refactor

**Files:**
- Modify: `apps/api/src/services/reconcile.ts`
- Test: `apps/api/src/services/overview.test.ts` (created here with the stages test; extended in Task 4 — this task owns the file)

**Interfaces:**
- Consumes: existing `firstRow`, `n`, `branchSql` helpers inside `reconcile.ts` (same file, no imports).
- Produces: `heldGoldStages(db, branchId?): Promise<{ products: number; oldGold: number; lots: number; wip: number; recovered: number; total: number }>` consumed by Task 2; `heldGoldMg` keeps its exact signature and result.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("heldGoldStages", () => {
  it("sums stages to the held total", async () => {
    const { heldGoldStages } = await import("./reconcile");
    const byFragment: [string, number][] = [
      ["FROM products", 1000],
      ["FROM old_gold_items", 200],
      ["FROM melting_outputs", 0],
      ["manufacturing_materials m", 300],
      ["type = 'RECOVERY'", 50],
    ];
    const db = {
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("SUM(o.fine_mg)")) return { total: 500, allocated: 100 };
            for (const [frag, val] of byFragment) if (sql.includes(frag)) return { fine_mg: val };
            return null;
          },
        }),
        first: async () => null,
      }),
    } as unknown as D1Database;
    const s = await heldGoldStages(db, "b1");
    expect(s.products).toBe(1000);
    expect(s.oldGold).toBe(200);
    expect(s.lots).toBe(400);
    expect(s.wip).toBe(300);
    expect(s.recovered).toBe(50);
    expect(s.total).toBe(1950);
  });
});
```

The lots query returns `{ total, allocated }` (not `fine_mg`) — the fake matches `SUM(o.fine_mg)` first so the generic `FROM melting_outputs` fragment never misfires. Order matters; keep the special-case first as written.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/overview.test.ts`
Expected: FAIL with "heldGoldStages is not defined" (export missing).

- [ ] **Step 3: Refactor reconcile.ts**

Split the body of `heldGoldMg` (lines ~78-133) into `heldGoldStages` returning each component, preserving every SQL string verbatim:

```ts
export async function heldGoldStages(db: D1Database, branchId?: string): Promise<{ products: number; oldGold: number; lots: number; wip: number; recovered: number; total: number }> {
  const bp = branchSql(branchId, "branch_id");
  const products = await firstRow<{ fine_mg: number }>(db, `SELECT COALESCE(SUM(fine_gold_mg), 0) AS fine_mg FROM products
     WHERE status NOT IN ('SOLD','RETURNED','VOID','LOST','MELTED')${bp.sql}`, bp.vals);
  ... // identical queries for oldGold, lots ({total, allocated}), wip, recovered
  const lotsNet = n(lots?.total) - n(lots?.allocated);
  const total = n(products?.fine_mg) + n(oldGold?.fine_mg) + lotsNet + n(wip?.fine_mg) + n(recovered?.fine_mg);
  return { products: n(products?.fine_mg), oldGold: n(oldGold?.fine_mg), lots: lotsNet, wip: n(wip?.fine_mg), recovered: n(recovered?.fine_mg), total };
}

export async function heldGoldMg(db: D1Database, branchId?: string): Promise<number> {
  return (await heldGoldStages(db, branchId)).total;
}
```

Copy each SQL string character-for-character from the current `heldGoldMg` (including the WHERE comments' queries, not the comments). Keep all existing comments on the queries they describe. `heldGoldMg`'s docstring behavior is unchanged, so `reconcile.test.ts` and day-close behavior are unaffected.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter goldos-api exec vitest run src/services/overview.test.ts` — Expected: PASS. Then `pnpm --filter goldos-api exec vitest run src/services/reconcile.test.ts` — Expected: PASS (untouched pure tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/reconcile.ts apps/api/src/services/overview.test.ts
git commit -m "feat: heldGoldStages breakdown with total preserved"
```

### Task 2: Overview service

**Files:**
- Create: `apps/api/src/services/overview.ts`

**Interfaces:**
- Consumes: `heldGoldStages` (Task 1); `accountBalance(db, code, branchId?)` from `./journal`; `listBankAccounts(db)` from `./cashbank`; `buildMonthlyReport(db, { month, year, branchId })` from `./monthly`.
- Produces: `branchOverview(db, branchId, opts: { year: number; month: number; userId: string; permissions: string[] }): Promise<BranchView>`, `allBranches(db, opts): Promise<{ asOf: number; branches: BranchView[] }>` consumed by Task 3. `BranchView` type exported for routes/tests.

- [ ] **Step 1: Write the service**

```ts
import { heldGoldStages } from "./reconcile";
import { accountBalance } from "./journal";
import { listBankAccounts } from "./cashbank";
import { buildMonthlyReport } from "./monthly";

export type BranchView = {
  branch: { id: string; name: string };
  asOf: number;
  month: string;
  jewellery: { pieces: number; netMg: number; fineMg: number; costCents: number; hasData: boolean };
  gold: { products: number; oldGold: number; lots: number; wip: number; recovered: number; fineMg: number; hasData: boolean };
  cash: { drawer: number; cardClearing: number; hasData: boolean };
  banks: { name: string; balanceCents: number; shared: boolean }[];
  staff: { name: string; roles: string[] }[] | { redacted: true };
  sales: { netCents: number; invoiceCount: number };
  purchases: { valueCents: number };
  transit: { linesOut: { count: number; fineMg: number }; linesIn: { count: number; fineMg: number }; cashInTransit: number };
};

async function requireMember(db: D1Database, userId: string, branchId: string, permissions: string[]): Promise<void> {
  if (permissions.includes("branches:manage")) return;
  const m = await db.prepare("SELECT 1 AS x FROM branch_members WHERE user_id = ? AND branch_id = ?").bind(userId, branchId).first();
  if (!m) throw Object.assign(new Error("Not a member of this branch"), { code: "FORBIDDEN" });
}

export async function branchOverview(db: D1Database, branchId: string, opts: { year: number; month: number; userId: string; permissions: string[] }): Promise<BranchView> {
  await requireMember(db, opts.userId, branchId, opts.permissions);
  const branch = await db.prepare("SELECT id, name FROM branches WHERE id = ? AND is_active = 1").bind(branchId).first<{ id: string; name: string }>();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const asOf = Date.now();
  const jew = await db.prepare("SELECT COUNT(*) AS pieces, COALESCE(SUM(net_mg),0) AS netMg, COALESCE(SUM(fine_gold_mg),0) AS fineMg, COALESCE(SUM(cost_cents),0) AS costCents FROM products WHERE status = 'IN_STOCK' AND branch_id = ?").bind(branchId).first<{ pieces: number; netMg: number; fineMg: number; costCents: number }>();
  const stages = await heldGoldStages(db, branchId);
  const drawer = await accountBalance(db, "1000", branchId);
  const cardClearing = await accountBalance(db, "1020", branchId);
  const accounts = await listBankAccounts(db);
  const banks = accounts.filter((a) => a.branch_id === branchId || a.branch_id === null).map((a) => ({ name: a.name, balanceCents: a.balance_cents, shared: a.branch_id === null }));
  let staff: BranchView["staff"];
  const member = await db.prepare("SELECT 1 AS x FROM branch_members WHERE user_id = ? AND branch_id = ?").bind(opts.userId, branchId).first();
  if (opts.permissions.includes("users:view") || member) {
    const { results } = await db.prepare(
      `SELECT u.name AS name, GROUP_CONCAT(r.name) AS roles FROM users u JOIN branch_members m ON m.user_id = u.id LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id WHERE m.branch_id = ? AND u.is_active = 1 GROUP BY u.id ORDER BY u.name`
    ).bind(branchId).all<{ name: string; roles: string | null }>();
    staff = (results ?? []).map((r) => ({ name: r.name, roles: r.roles ? r.roles.split(",") : [] }));
  } else staff = { redacted: true };
  const monthly = await buildMonthlyReport(db, { month: opts.month, year: opts.year, branchId });
  const linesOut = await db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(p.fine_gold_mg),0) AS mg FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id JOIN products p ON p.id = l.product_id WHERE l.status = 'IN_TRANSIT' AND t.from_branch_id = ?").bind(branchId).first<{ c: number; mg: number }>();
  const linesIn = await db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(p.fine_gold_mg),0) AS mg FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id JOIN products p ON p.id = l.product_id WHERE l.status = 'IN_TRANSIT' AND t.to_branch_id = ?").bind(branchId).first<{ c: number; mg: number }>();
  const cashTransit = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM cash_transfers WHERE from_branch_id = ? AND status = 'IN_TRANSIT'").bind(branchId).first<{ n: number }>();
```

`cash_transfers.status` values are `IN_TRANSIT|COMPLETE` per `database.md` migration `0018` — verify against `cashbank.ts` before committing; if the in-flight value differs, match that file, not this plan.

```ts
  return {
    branch: { id: branch.id, name: branch.name },
    asOf,
    month: monthly.meta.month,
    jewellery: { pieces: jew?.pieces ?? 0, netMg: jew?.netMg ?? 0, fineMg: jew?.fineMg ?? 0, costCents: jew?.costCents ?? 0, hasData: (jew?.pieces ?? 0) > 0 },
    gold: { ...stages, fineMg: stages.total, hasData: stages.total !== 0 },
    cash: { drawer, cardClearing, hasData: drawer !== 0 || cardClearing !== 0 },
    banks,
    staff,
    sales: { netCents: monthly.sales.netCents, invoiceCount: monthly.sales.invoiceCount },
    purchases: { valueCents: monthly.purchases.purchaseValueCents },
    transit: { linesOut: { count: linesOut?.c ?? 0, fineMg: linesOut?.mg ?? 0 }, linesIn: { count: linesIn?.c ?? 0, fineMg: linesIn?.mg ?? 0 }, cashInTransit: cashTransit?.n ?? 0 },
  };
}

export async function allBranches(db: D1Database, opts: { year: number; month: number; userId: string; permissions: string[] }): Promise<{ asOf: number; branches: BranchView[] }> {
  if (!opts.permissions.includes("branches:manage")) throw Object.assign(new Error("branches:manage required"), { code: "FORBIDDEN" });
  const { results } = await db.prepare("SELECT id FROM branches WHERE is_active = 1 ORDER BY name").bind().all<{ id: string }>();
```

`SELECT ... .bind()` with no args: `sales.ts:190` uses `.bind()` with no arguments successfully against D1, so this matches the codebase pattern. If D1 rejects it at runtime, drop `.bind()` and call `.all()` directly (the `firstRow` helper in `reconcile.ts` exists for exactly this reason — use it instead).

```ts
  const branches: BranchView[] = [];
  for (const b of results ?? []) branches.push(await branchOverview(db, b.id, opts));
  return { asOf: Date.now(), branches };
}
```

`allBranches` calls `branchOverview` per branch (each filters by its own `branch_id`); there is deliberately no summation across branches — the response has no `total` key.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS. (If `listBankAccounts` row type name differs — check `cashbank.ts:55-62` `BankAccountRow` fields `branch_id`, `balance_cents` — and adjust.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/overview.ts
git commit -m "feat: branch overview read service"
```

### Task 3: Overview routes + registration

**Files:**
- Create: `apps/api/src/routes/overview.ts`
- Modify: `apps/api/src/app.ts` (import + `app.route("/api/v1/branch-overview", overview)`)

**Interfaces:**
- Consumes: `branchOverview, allBranches` from Task 2; `PERMISSIONS.BRANCHES_VIEW/MANAGE, AUDIT_EXPORT`; `monthlyQuerySchema`-style query validation (reuse `monthlyQuerySchema` from `@goldos/shared` for month/year — branchId validated as plain string).
- Produces: `GET /branch-overview?branchId=&month=&year=`, `GET /branch-overview/all?month=&year=`, each with `?format=csv` (single view only).

- [ ] **Step 1: Write the routes file**

```ts
import { Hono } from "hono";
import { monthlyQuerySchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { allBranches, branchOverview } from "../services/overview";
import { toCsv } from "../services/discrepancies";
import { serviceError } from "./http";

export const overview = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.BRANCHES_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year"), branchId: c.req.query("branchId") ?? undefined });
    if (!parsed.success || !parsed.data.branchId) return c.json({ success: false, error: { code: "VALIDATION", message: "branchId, month 1-12 and year required" } }, 400);
    try {
      const data = await branchOverview(c.env.DB, parsed.data.branchId, { year: parsed.data.year, month: parsed.data.month, userId: c.get("userId"), permissions: c.get("permissions") as string[] });
      if (c.req.query("format") === "csv") {
        if (!(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT))
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        const flat = { branch: data.branch.name, asOf: new Date(data.asOf).toISOString(), pieces: data.jewellery.pieces, netMg: data.jewellery.netMg, fineMg: data.jewellery.fineMg, costCents: data.jewellery.costCents, goldMg: data.gold.fineMg, drawer: data.cash.drawer, cardClearing: data.cash.cardClearing, salesNet: data.sales.netCents, invoices: data.sales.invoiceCount, purchases: data.purchases.valueCents };
        return new Response(toCsv([`generated_at: ${new Date().toISOString()}`, `branch: ${data.branch.name}`, "source: live-read"], Object.keys(flat), flat as unknown as Record<string, unknown>), { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/all", requirePerm(PERMISSIONS.BRANCHES_MANAGE), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year") });
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    try {
      const data = await allBranches(c.env.DB, { year: parsed.data.year, month: parsed.data.month, userId: c.get("userId"), permissions: c.get("permissions") as string[] });
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  });
```

`monthlyQuerySchema` includes optional categoryId/purityId/staffId — harmless passthrough, ignored. Route order: `/` before `/all` is fine (distinct paths; Hono matches exact `/all` before `/:id`-style params — and there is no `/:id` route here, so no conflict).

- [ ] **Step 2: Register in app.ts + typecheck**

Add `import { overview } from "./routes/overview";` and `app.route("/api/v1/branch-overview", overview);`. Run: `pnpm --filter goldos-api exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/overview.ts apps/api/src/app.ts
git commit -m "feat: branch overview routes with csv"
```

### Task 4: Overview tests

**Files:**
- Modify: `apps/api/src/services/overview.test.ts` (extend the Task 1 file)

**Interfaces:**
- Consumes: `branchOverview` (Task 2) with fake DB.
- Produces: green suite proving no-mix shape, redaction, transit exclusion, empty zeros.

- [ ] **Step 1: Extend the test file**

```ts
describe("branchOverview guards", () => {
  function branchDb() {
    return {
      batch: async (..._a: unknown[]) => {},
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM branch_members")) return { x: 1 };
            if (sql.includes("FROM branches WHERE id")) return { id: "b1", name: "Main" };
            if (sql.includes("FROM products WHERE status")) return { pieces: 2, netMg: 10000, fineMg: 9160, costCents: 50000 };
            if (sql.includes("journal_lines")) return { dr: 1000, cr: 0, n: 1000 };
            if (sql.includes("FROM transfer_lines")) return { c: 0, mg: 0 };
            if (sql.includes("FROM cash_transfers")) return { n: 0 };
            if (sql.includes("FROM gold_ledger")) return { n: 0 };
            if (sql.includes("FROM sales_invoices")) return { g: 0, c: 0 };
            if (sql.includes("FROM sales_returns")) return { r: 0 };
            if (sql.includes("FROM expenses")) return { p: 0, pend: 0 };
            if (sql.includes("FROM purities")) return { permille: 916 };
            return { n: 0, fine_mg: 0, total: 0, allocated: 0, g: 0, c: 0, r: 0, p: 0, pend: 0, dr: 0, cr: 0 };
          },
          all: async () => {
            if (sql.includes("FROM bank_accounts")) return { results: [] };
            if (sql.includes("FROM users")) return { results: [{ name: "Asha", roles: "owner" }] };
            if (sql.includes("FROM stock_counts")) return { results: [] };
            if (sql.includes("FROM count_scans")) return { results: [] };
            if (sql.includes("FROM gold_ledger")) return { results: [] };
            if (sql.includes("expense_categories")) return { results: [] };
            return { results: [] };
          },
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;
  }
  it("keeps transit out of shelf figures and redacts nothing for members", async () => {
    const { branchOverview } = await import("./overview");
    const v = await branchOverview(branchDb(), "b1", { year: 2026, month: 9, userId: "u1", permissions: ["branches:view"] });
    expect(v.jewellery.pieces).toBe(2);
    expect(v.transit.linesOut.count).toBe(0);
    expect(v.staff).toEqual([{ name: "Asha", roles: ["owner"] }]);
  });
  it("redacts staff for non-members without users:view", async () => {
    const { branchOverview } = await import("./overview");
    const db = branchDb();
    const strict = { ...db, prepare: (sql: string) => {
      const stmt = (db.prepare as (s: string) => { bind: (...v: unknown[]) => { first: () => Promise<null>; all: () => Promise<{ results: [] }> } })(sql);
      return { ...stmt, bind: (...v: unknown[]) => ({ ...stmt.bind(...v), first: async () => sql.includes("FROM branch_members") && sql.includes("branch_id") ? null : stmt.bind(...v).first() }) };
    } } as unknown as D1Database;
    void strict;
    const v = await branchOverview(branchDb(), "b1", { year: 2026, month: 9, userId: "u9", permissions: ["branches:view"] });
    expect(v.staff).toEqual([{ name: "Asha", roles: ["owner"] }]);
  });
});
```

The second test as written does NOT prove redaction (the setup is convoluted and asserts names). Replace it before committing with a direct redaction test: fake `branch_members` → null for the staff check while `requireMember` also fails — but then `branchOverview` throws FORBIDDEN before reaching staff. Redaction only triggers when the caller passes `requireMember` (member or manage) yet lacks `users:view` AND is not a member — impossible via membership alone, since membership grants names. The real redaction path is: `branches:manage` holder viewing a branch they are NOT a member of, without `users:view`. Rewrite the test to that: `branch_members` → null, permissions `["branches:view","branches:manage"]` (no `users:view`) → expect `{ redacted: true }`. And `requireMember` passes via manage. This is the meaningful case — implement it this way, not as drafted above.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter goldos-api exec vitest run src/services/overview.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full suite**

Run: `pnpm --filter goldos-api exec vitest run`
Expected: PASS — 12 files, no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/overview.test.ts
git commit -m "test: branch overview guards and redaction"
```

## Self-Review

- Spec §2 (endpoints): Tasks 2–3 — single + `/all` shapes, `asOf` vs month labeling, shared-bank flag, staff redaction rule, per-branch-only CSV. Covered.
- Spec §3 (no-mix): Tasks 2 + 4 — per-branch filters, no totals, transit-only lines. Covered.
- Spec §4 (testing): Tasks 1 + 4 — stages sum, no-mix shape (assert `"total" in allBranches-result` is false in the test run via JSON key check — add `expect(JSON.stringify(await allBranches(...))).not.toContain('"total"')` using the branchDb fake with a branches list; the fake needs `FROM branches` → `[{id:"b1"},{id:"b2"}]` handling), reuse (branch sales equals `buildMonthlyReport` on same fake — implicitly covered since the service calls it; assert `v.sales.netCents === (await buildMonthlyReport(db,{month,year,branchId})).sales.netCents`), redaction (rewritten manage-holder case), transit, empty zeros.
- Placeholder scan: no TBD/TODO; the Task 2 `cash_transfers.status` and `.bind()` notes and Task 4 test rewrite are explicit instructions.
- Type consistency: `BranchView` fields identical in service/routes/tests; `branchOverview(db, branchId, { year, month, userId, permissions })`, `allBranches(db, { year, month, userId, permissions })` everywhere.
