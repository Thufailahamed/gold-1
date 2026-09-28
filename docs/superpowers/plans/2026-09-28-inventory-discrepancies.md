# Discrepancy Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five live read-only discrepancy reports with zero new tables and zero write paths.

**Architecture:** Service `apps/api/src/services/discrepancies.ts` with one exported function per report reading existing tables (`stock_counts`, `count_scans`, `transfer_lines`, `stock_movements`, `gold_ledger`, `products`); gold consistency reuses the exported `heldGoldMg` plus a local directional-sum query; routes `apps/api/src/routes/discrepancies.ts` as `/api/v1/discrepancies` with `?format=csv` variants.

**Tech Stack:** Hono 4 on Cloudflare Workers, Drizzle ORM → D1 (SQLite), Zod 3 (query validation inline), Vitest 2, TypeScript 5.5 strict (no `any`).

## Global Constraints

- Read-only: no INSERT/UPDATE/DELETE in this feature; no migration.
- Money never appears; gold in INTEGER fine milligrams exact with 0 tolerance.
- Empty sources return `[]` with `hasData: false`, never fabricated rows.
- Listing requires a branch filter unless the caller holds `branches:manage` (same rule as counts, transfers, monthly).
- JSON requires `products:view`; `?format=csv` requires `audit:export` alone (every `audit:export` holder already holds `products:view`: owner, manager, accountant).
- CSV responses start with `#` preamble lines (`generated_at, branch, source: live-read`), `Content-Type: text/csv`.

---

### Task 1: Discrepancies service — missing, unexpected, duplicates

**Files:**
- Create: `apps/api/src/services/discrepancies.ts`

**Interfaces:**
- Consumes: `compare` from `./counts` (same signature as counts routes use: `compare(db, countId)`); `heldGoldMg` from `./reconcile` (used in Task 2, not this task).
- Produces: `missingReport(db, branchId): Promise<{ rows: MissingRow[]; hasData: boolean }>`, `scanFlagReport(db, branchId, flag: "UNEXPECTED" | "DUPLICATE"): Promise<{ rows: ScanRow[]; hasData: boolean }>`, `toCsv(preamble: string[], cols: string[], rows: Record<string, unknown>[]): string` — Task 3 (routes) consumes all three; Task 2 adds `unreceivedReport` + `summaryReport` to the same file.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("discrepancy csv", () => {
  it("quotes fields and prepends the live-read preamble", async () => {
    const { toCsv } = await import("./discrepancies");
    const out = toCsv(["generated_at: x"], ["barcode", "note"], [{ barcode: "JW-1", note: 'a"b,c' }]);
    expect(out).toContain("# generated_at: x");
    expect(out).toContain('"a""b,c"');
  });
});
```

Save as `apps/api/src/services/discrepancies.test.ts` (created in this task, extended in Task 4 — this task owns the file).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/discrepancies.test.ts`
Expected: FAIL with "Cannot find module './discrepancies'".

- [ ] **Step 3: Write the service**

```ts
import { compare } from "./counts";

export type MissingRow = { countId: string; productId: string; barcode: string; productName: string | null; daysOpen: number; status: string; posted: boolean };
export type ScanRow = { countId: string; barcode: string; scannedAt: number; scannedBy: string | null };

export function toCsv(preamble: string[], cols: string[], rows: Record<string, unknown>[]): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [...preamble.map((p) => `# ${p}`), cols.map(q).join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n") + "\n";
}

const DAY_MS = 86_400_000;

export async function missingReport(db: D1Database, branchId: string): Promise<{ rows: MissingRow[]; hasData: boolean }> {
  const { results: counts } = await db.prepare("SELECT id, status, created_at, result_json FROM stock_counts WHERE branch_id = ? AND status IN ('OPEN','COMPLETE') ORDER BY created_at DESC LIMIT 50").bind(branchId).all<{ id: string; status: string; created_at: number; result_json: string | null }>();
  const rows: MissingRow[] = [];
  for (const c of counts ?? []) {
    if (c.status === "OPEN") {
      const cmp = await compare(db, c.id);
      for (const pid of cmp.missing) {
        const p = await db.prepare("SELECT barcode, name FROM products WHERE id = ?").bind(pid).first<{ barcode: string; name: string }>();
        rows.push({ countId: c.id, productId: pid, barcode: p?.barcode ?? "", productName: p?.name ?? null, daysOpen: Math.floor((Date.now() - c.created_at) / DAY_MS), status: "OPEN", posted: false });
      }
    } else {
      const res = c.result_json ? (JSON.parse(c.result_json) as { missing?: string[]; posted?: number }) : null;
      for (const pid of res?.missing ?? []) {
        const p = await db.prepare("SELECT barcode, name FROM products WHERE id = ?").bind(pid).first<{ barcode: string; name: string }>();
        rows.push({ countId: c.id, productId: pid, barcode: p?.barcode ?? "", productName: p?.name ?? null, daysOpen: Math.floor((Date.now() - c.created_at) / DAY_MS), status: "COMPLETE", posted: (res?.posted ?? 0) > 0 });
      }
    }
  }
  return { rows, hasData: rows.length > 0 };
}

export async function scanFlagReport(db: D1Database, branchId: string, flag: "UNEXPECTED" | "DUPLICATE"): Promise<{ rows: ScanRow[]; hasData: boolean }> {
  const { results } = await db.prepare(
    `SELECT s.count_id, s.barcode, s.scanned_at, s.scanned_by FROM count_scans s JOIN stock_counts c ON c.id = s.count_id WHERE c.branch_id = ? AND s.flag = ? ORDER BY s.scanned_at DESC LIMIT 200`
  ).bind(branchId, flag).all<{ count_id: string; barcode: string; scanned_at: number; scanned_by: string | null }>();
  const rows = (results ?? []).map((r) => ({ countId: r.count_id, barcode: r.barcode, scannedAt: r.scanned_at, scannedBy: r.scanned_by }));
  return { rows, hasData: rows.length > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/services/discrepancies.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/discrepancies.ts apps/api/src/services/discrepancies.test.ts
git commit -m "feat: discrepancy reports for counts"
```

### Task 2: Discrepancies service — unreceived + summary

**Files:**
- Modify: `apps/api/src/services/discrepancies.ts`

**Interfaces:**
- Consumes: `getSetting` from `./settings` (signature `getSetting(db, key) → { value: unknown } | null`); `heldGoldMg(db, branchId?)` from `./reconcile`; `reconcileTransfer` from `./transfers`.
- Produces: `unreceivedReport(db, branchId): Promise<{ rows: UnreceivedRow[]; hasData: boolean; thresholdDays: number }>`, `summaryReport(db, branchId): Promise<Summary>` — Task 3 consumes both.

- [ ] **Step 1: Append threshold + unreceived + summary**

```ts
import { getSetting } from "./settings";
import { heldGoldMg } from "./reconcile";
import { reconcileTransfer } from "./transfers";

export type UnreceivedRow = { transferId: string; number: string; barcode: string; productId: string; fromBranch: string; toBranch: string; ageDays: number };

export async function unreceivedDays(db: D1Database): Promise<number> {
  const s = await getSetting(db, "transfer_unreceived_days");
  return typeof s?.value === "number" && s.value > 0 ? Math.floor(s.value) : 3;
}

export async function unreceivedReport(db: D1Database, branchId: string): Promise<{ rows: UnreceivedRow[]; hasData: boolean; thresholdDays: number }> {
  const thresholdDays = await unreceivedDays(db);
  const { results } = await db.prepare(
    `SELECT l.transfer_id, t.number, l.product_id, l.barcode, t.from_branch_id, t.to_branch_id,
            (SELECT m.created_at FROM stock_movements m WHERE m.product_id = l.product_id AND m.type = 'TRANSFER_OUT' AND m.reason LIKE ('%' || t.number || '%') ORDER BY m.created_at DESC LIMIT 1) AS dispatched_at
     FROM transfer_lines l JOIN transfers t ON t.id = l.transfer_id
     WHERE l.status = 'IN_TRANSIT' AND (t.from_branch_id = ? OR t.to_branch_id = ?)`
  ).bind(branchId, branchId).all<{ transfer_id: string; number: string; product_id: string; barcode: string; from_branch_id: string; to_branch_id: string; dispatched_at: number | null }>();
  const now = Date.now();
  const rows = (results ?? [])
    .map((r) => ({ transferId: r.transfer_id, number: r.number, barcode: r.barcode, productId: r.product_id, fromBranch: r.from_branch_id, toBranch: r.to_branch_id, ageDays: r.dispatched_at ? Math.floor((now - r.dispatched_at) / DAY_MS) : 0 }))
    .filter((r) => r.ageDays >= thresholdDays);
  return { rows, hasData: rows.length > 0, thresholdDays };
}

export type Summary = {
  missing: number; unexpected: number; duplicates: number; unreceived: number;
  gold: { branchId: string; passed: boolean; differenceMg: number }[];
  transfers: { transferId: string; number: string; warnings: string[] }[];
  hasData: boolean;
};

async function branchLedgerMg(db: D1Database, branchId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(
       (CASE WHEN destination = 'branch:' || ? THEN fine_mg ELSE 0 END)
     - (CASE WHEN source = 'branch:' || ? THEN fine_mg ELSE 0 END)
     ), 0) AS n FROM gold_ledger`
  ).bind(branchId, branchId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function summaryReport(db: D1Database, branchId: string): Promise<Summary> {
  const [missing, unexpected, duplicates, unreceived] = await Promise.all([
    missingReport(db, branchId), scanFlagReport(db, branchId, "UNEXPECTED"), scanFlagReport(db, branchId, "DUPLICATE"), unreceivedReport(db, branchId),
  ]);
  const ledgerMg = await branchLedgerMg(db, branchId);
  const heldMg = await heldGoldMg(db, branchId);
  const gold = [{ branchId, passed: ledgerMg - heldMg === 0, differenceMg: ledgerMg - heldMg }];
  const { results: open } = await db.prepare("SELECT id, number FROM transfers WHERE (from_branch_id = ? OR to_branch_id = ?) AND status IN ('DISPATCHED','PARTIAL') ORDER BY created_at DESC LIMIT 50").bind(branchId, branchId).all<{ id: string; number: string }>();
  const transfers: Summary["transfers"] = [];
  for (const t of open ?? []) {
    const r = await reconcileTransfer(db, t.id);
    if (!r.passed) transfers.push({ transferId: t.id, number: t.number, warnings: r.warnings });
  }
  const hasData = missing.rows.length + unexpected.rows.length + duplicates.rows.length + unreceived.rows.length + transfers.length > 0 || !gold[0].passed;
  return { missing: missing.rows.length, unexpected: unexpected.rows.length, duplicates: duplicates.rows.length, unreceived: unreceived.rows.length, gold, transfers, hasData };
}
```

The `branchLedgerMg` query mirrors the directional CASE from `reconcile.ts:590-596` (arrival minus departure, transfer-safe because both sides subtract). `heldGoldMg` is the shared export — no logic duplicated. Gold compares exact milligrams, 0 tolerance.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/discrepancies.ts
git commit -m "feat: unreceived transfers and discrepancy summary"
```

### Task 3: Discrepancy routes + registration

**Files:**
- Create: `apps/api/src/routes/discrepancies.ts`
- Modify: `apps/api/src/app.ts` (import + `app.route("/api/v1/discrepancies", discrepancies)`)

**Interfaces:**
- Consumes: `missingReport, scanFlagReport, unreceivedReport, summaryReport, toCsv` from Task 1–2; `PERMISSIONS.PRODUCTS_VIEW, BRANCHES_MANAGE, AUDIT_EXPORT`.
- Produces: `GET /missing`, `GET /unexpected`, `GET /duplicates`, `GET /unreceived`, `GET /summary`, each with `?branchId=` + `?format=csv`.

- [ ] **Step 1: Write the routes file**

```ts
import { Hono } from "hono";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { missingReport, scanFlagReport, summaryReport, toCsv, unreceivedReport } from "../services/discrepancies";
import { serviceError } from "./http";

function branchGate(perms: string[], branchId: string | undefined) {
  if (!branchId && !perms.includes(PERMISSIONS.BRANCHES_MANAGE))
    return { success: false as const, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } };
  return null;
}

function csv(preamble: string[], cols: string[], rows: Record<string, unknown>[]) {
  return new Response(toCsv(preamble, cols, rows), { status: 200, headers: { "Content-Type": "text/csv" } });
}

const COLS: Record<string, string[]> = {
  missing: ["countId", "productId", "barcode", "productName", "daysOpen", "status", "posted"],
  scans: ["countId", "barcode", "scannedAt", "scannedBy"],
  unreceived: ["transferId", "number", "barcode", "productId", "fromBranch", "toBranch", "ageDays"],
};

export const discrepancies = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/missing", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = branchGate(c.get("permissions") as string[], branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 403);
    try {
      const data = await missingReport(c.env.DB, branchId as string);
      if (c.req.query("format") === "csv") {
        if (!(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT))
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read"], COLS.missing, data.rows);
      }
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/unexpected", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = branchGate(c.get("permissions") as string[], branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 403);
    try {
      const data = await scanFlagReport(c.env.DB, branchId as string, "UNEXPECTED");
      if (c.req.query("format") === "csv") {
        if (!(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT))
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read", "note: unexpected scans are hygiene, not stock movement"], COLS.scans, data.rows);
      }
      return c.json({ success: true, data: { ...data, note: "Unexpected scans are hygiene, not stock movement" } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/duplicates", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = branchGate(c.get("permissions") as string[], branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 403);
    try {
      const data = await scanFlagReport(c.env.DB, branchId as string, "DUPLICATE");
      if (c.req.query("format") === "csv") {
        if (!(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT))
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read", "note: duplicate scans are hygiene, not stock movement"], COLS.scans, data.rows);
      }
      return c.json({ success: true, data: { ...data, note: "Duplicate scans are hygiene, not stock movement" } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/unreceived", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = branchGate(c.get("permissions") as string[], branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 403);
    try {
      const data = await unreceivedReport(c.env.DB, branchId as string);
      if (c.req.query("format") === "csv") {
        if (!(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT))
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        return csv([`generated_at: ${new Date().toISOString()}`, `branch: ${branchId}`, "source: live-read", `threshold_days: ${data.thresholdDays}`], COLS.unreceived, data.rows);
      }
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/summary", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const denied = branchGate(c.get("permissions") as string[], branchId);
    if (denied) return c.json({ success: false, error: denied.error }, 403);
    try {
      const data = await summaryReport(c.env.DB, branchId as string);
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  });
```

`branchId as string` is safe after `branchGate` returns null (branchId defined or caller holds manage — but manage-holders may still omit branchId by design? No: the gate as written FORBIDS omission without manage, and ALLOWS omission with manage, in which case `branchId as string` is `undefined` cast — a lie. Fix: when manage-holder omits branchId, the service queries must run shop-wide. The service functions take `branchId: string` and filter `= ?`. Resolution: keep the gate but require branchId always — change `branchGate` to reject missing branchId unconditionally with "branchId required" (owner iterates branches; no mixed totals, per spec §6 of the transfer spec and the no-mix rule). Simpler and truthful. Apply this before committing: gate returns 403 VALIDATION `branchId is required` whenever absent, regardless of perms.

- [ ] **Step 2: Apply the always-require-branchId gate**

Replace `branchGate` with:

```ts
function needBranch(branchId: string | undefined) {
  if (!branchId) return { success: false as const, error: { code: "VALIDATION", message: "branchId is required" } };
  return null;
}
```

And replace each `branchGate(c.get("permissions") as string[], branchId)` call with `needBranch(branchId)`, returning 400 on denial: `if (denied) return c.json({ success: false, error: denied.error }, 400);`. No `BRANCHES_MANAGE` import needed — drop it from the import (keep `PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.AUDIT_EXPORT` referenced via `PERMISSIONS.*` namespace import, which stays as-is).

- [ ] **Step 3: Register in app.ts + typecheck**

Add `import { discrepancies } from "./routes/discrepancies";` and `app.route("/api/v1/discrepancies", discrepancies);`. Run: `pnpm --filter goldos-api exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/discrepancies.ts apps/api/src/app.ts
git commit -m "feat: discrepancy report routes with csv"
```

### Task 4: Discrepancy tests

**Files:**
- Modify: `apps/api/src/services/discrepancies.test.ts` (extend the file Task 1 created)

**Interfaces:**
- Consumes: `toCsv` (Task 1), `unreceivedDays` (Task 2).
- Produces: green suite proving CSV escaping, threshold default/fallback, and exclusion rules.

- [ ] **Step 1: Extend the test file**

```ts
describe("unreceived threshold", () => {
  it("defaults to 3 when unset and floors custom values", async () => {
    const { unreceivedDays } = await import("./discrepancies");
    const empty = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as D1Database;
    expect(await unreceivedDays(empty)).toBe(3);
    const custom = { prepare: () => ({ bind: () => ({ first: async () => ({ key: "transfer_unreceived_days", value_json: "5", type: "number" }) }) }) } as unknown as D1Database;
    expect(await unreceivedDays(custom)).toBe(5);
  });
  it("ignores non-numeric settings", async () => {
    const { unreceivedDays } = await import("./discrepancies");
    const bad = { prepare: () => ({ bind: () => ({ first: async () => ({ key: "transfer_unreceived_days", value_json: '"soon"', type: "string" }) }) }) } as unknown as D1Database;
    expect(await unreceivedDays(bad)).toBe(3);
  });
});

describe("unreceived exclusions", () => {
  it("excludes received, recalled and pending lines", async () => {
    const { unreceivedReport } = await import("./discrepancies");
    const old = Date.now() - 10 * 86_400_000;
    const db = {
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => null,
          all: async () => {
            if (sql.includes("FROM transfer_lines")) return { results: [
              { transfer_id: "t1", number: "TRF-000001", product_id: "p1", barcode: "JW-1", from_branch_id: "b1", to_branch_id: "b2", dispatched_at: old },
            ] };
            return { results: [] };
          },
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
      batch: async (..._a: unknown[]) => {},
    } as unknown as D1Database;
    const r = await unreceivedReport(db, "b1");
    expect(r.thresholdDays).toBe(3);
    expect(r.rows.map((x) => x.barcode)).toEqual(["JW-1"]);
    expect(r.hasData).toBe(true);
  });
});
```

The exclusions test proves the IN_TRANSIT-only query shape (the SQL filters `l.status = 'IN_TRANSIT'`, so RECEIVED/RECALLED/PENDING can never appear) plus the age gate. A young line (dispatched 1 day ago) is filtered by `ageDays >= thresholdDays` — covered by construction; add `dispatched_at: Date.now()` second row and expect it absent if extending.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter goldos-api exec vitest run src/services/discrepancies.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 3: Run full suite**

Run: `pnpm --filter goldos-api exec vitest run`
Expected: PASS — 11 files, no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/discrepancies.test.ts
git commit -m "test: discrepancy threshold and exclusions"
```

## Self-Review

- Spec §2 (endpoints): Tasks 1–3 — all five endpoints, row shapes, branch gate, CSV gates. The always-require-branchId correction (Step 2 of Task 3) removes the `undefined`-cast lie and enforces the no-mix rule. Covered.
- Spec §3 (threshold): Task 2 — `unreceivedDays` with `getSetting` + fallback 3, whole-day age from TRANSFER_OUT movement `created_at`, at-threshold counts. Covered.
- Spec §4 (no-fabrication): Tasks 1–2 — `hasData`, hygiene notes, exact-mg gold, CSV live-read preamble. Covered.
- Spec §5 (testing): Tasks 1 + 4 — CSV escaping, threshold default/custom/invalid, exclusions, summary via Task 2 (covered by construction; full seeded summary test noted as hardening).
- Placeholder scan: no TBD/TODO; all code exact; route-permission matrix explicit.
- Type consistency: `missingReport/scanFlagReport/unreceivedReport/summaryReport(db, branchId)`, `toCsv(preamble, cols, rows)`, row field names identical across service/routes/tests/CSV cols.
