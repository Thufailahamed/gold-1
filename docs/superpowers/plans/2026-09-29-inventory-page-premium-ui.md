# Inventory Page Premium UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/inventory` as a premium page matching the dashboard's visual language, backed by six new shared UI primitives and one new read-only API endpoint.

**Architecture:** An additive `inventoryInsights(db)` service function plus one `GET /inventory/insights` route supply hero totals, per-karat and per-branch breakdowns, and an attention summary. Six new exports in `components/ui.tsx` (`MetricCard`, `BarList`, `GaugeRing`, `DataTable`, `FilterChips`, `Field`) generalise the dashboard's page-local premium components. The inventory page splits into `page.tsx` / `panels.tsx` / `columns.tsx`. The dashboard is not refactored onto the new primitives in this slice.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5.5, Tailwind 3.4 with the project's gold/ink/paper theme, TanStack Query v5, Recharts 3, Hono 4 on Cloudflare D1, Vitest 2, Zod 3, `sonner` toasts.

**Spec:** `docs/superpowers/specs/2026-09-29-inventory-page-premium-ui-design.md`

## Global Constraints

These apply to every task. Do not deviate without updating the spec first.

- **Additive only in `components/ui.tsx`.** No existing export may be edited, renamed, or have its props changed. 25 pages import it. `tsc --noEmit` over the whole web app is the gate.
- **No schema migration.** No file under `apps/api/drizzle/` may be created or modified. The `products.status` and `stock_movements.created_at` indexes already cover the new queries.
- **No new dependencies.** Recharts, TanStack Query, Zod, clsx, tailwind-merge, sonner are already in `apps/web/package.json`. Do not add a component library, a table library, a form library, or an animation library.
- **Value arithmetic must match `stockSummary` exactly.** Price per product is `Math.round((net_mg * rate_cents_per_g) / 1000)`, where `rate_cents_per_g` comes from `currentGoldRatesCents(db)`. Any code path that prices stock must use this formula or a shared helper that uses it.
- **Insights scope is `status = 'IN_STOCK'` only**, matching `stockSummary`. `attention` is the sole exception and deliberately counts non-`IN_STOCK` statuses.
- **Missing gold rate means `0`, never `NaN` and never a thrown error.** The UI must keep rendering when no rates are published.
- **Design tokens only.** `gold.{DEFAULT,dark,deep,light,soft,pale}`, `ink.1`–`ink.7`, `paper`, `bone`, `mist`, `void`. Shadows `1`–`5`, `pop`, `glow`. Durations `140/180/200/240/320`. Easings `brand`, `cinematic`. No arbitrary hex values; the existing gradient CSS lives in `apps/web/app/globals.css` under `home-*` classes and must be reused, not duplicated inline.
- **Never remove a focus ring.** Use the existing `focus:shadow-[inset_0_0_0_1px_#1c1917,0_0_0_3px_rgba(201,162,39,0.3)]` pattern from `controlClass`.
- **All decorative layers** (glows, grid textures, noise, gradients) are `pointer-events-none` and `aria-hidden`.
- **All motion respects `prefers-reduced-motion`.** Add `motion-reduce:transition-none` to every new transition.
- **Formatting is never hardcoded in a shared primitive.** Shared components take a `format` callback; pages pass `mgToG` / `centsToLkr` from `@goldos/shared`.
- **Page-local files stay under ~250 lines each.**
- **TypeScript strictness:** the repo runs `tsc --noEmit` as its only web lint. No `any`, no non-null assertions without a guard, no unused locals.

## File Structure

**API**
- `apps/api/src/services/inventory.ts` — add `inventoryInsights(db)`, `KaratLine`, `BranchLine`, `InventoryInsights`, and a `priceStock()` helper. Pure addition; nothing existing changes.
- `apps/api/src/routes/inventory.ts` — add the `GET /insights` handler.
- `apps/api/src/services/inventory-insights.test.ts` — new. Hand-rolled D1 stub, same shape as `inventory-correctness.test.ts`.

**Web — shared**
- `apps/web/components/ui.tsx` — six new exports appended.
- `apps/web/lib/count-up.ts` — new. `useCountUp(target, ms)`, moved out of the dashboard.
- `apps/web/app/(app)/dashboard/page.tsx` — delete the local `useCountUp`, import from `lib/count-up`. Pure move.

**Web — page**
- `apps/web/app/(app)/inventory/page.tsx` — composition, queries, mutation, state.
- `apps/web/app/(app)/inventory/panels.tsx` — `InventoryHero`, `StockByKarat`, `StockByBranch`, `AttentionCard`, `QueryError`, `PiecePreview`, `MovementFilters`, `PieceDetail`.
- `apps/web/app/(app)/inventory/columns.tsx` — `stockColumns`, `movementColumns`, `MovementTypeIcon`, and the `Movement`/`StockRow`/`Insights` types.

**Task order:** each task ends at a working, independently verifiable state. Tasks 1–2 are the API, 3–5 the primitives, 6–9 the page.

---

### Task 1: `inventoryInsights` service + tests

**Files:**
- Modify: `apps/api/src/services/inventory.ts` (append at end of file)
- Create: `apps/api/src/services/inventory-insights.test.ts`

**Interfaces:**
- Consumes: `currentGoldRatesCents(db)` from `../services/rates` (already imported in `inventory.ts` as `import { currentGoldRatesCents } from "./rates"`). `GoldRateCentsRow` = `{ id, purity_id, karat, rate_cents_per_g, effective_from, created_at }`.
- Produces:
  ```ts
  export type KaratLine = {
    purity_id: string; karat: string; permille: number;
    pieces: number; net_mg: number; fine_mg: number; value_cents: number;
  };
  export type BranchLine = {
    branch_id: string; name: string; pieces: number;
    net_mg: number; fine_mg: number; value_cents: number;
  };
  export type InventoryInsights = {
    totals: { pieces: number; net_mg: number; fine_mg: number; value_cents: number };
    byKarat: KaratLine[];
    byBranch: BranchLine[];
    attention: {
      transfer_pending: number; in_repair: number; reserved: number;
      last_movement_at: number | null; movements_24h: number;
    };
  };
  export function priceStock(netMg: number, rateCentsPerG: number | undefined): number;
  export async function inventoryInsights(db: D1Database): Promise<InventoryInsights>;
  ```

- [ ] **Step 1: Write the failing test file**

Create `apps/api/src/services/inventory-insights.test.ts`:

```ts
import { describe, expect, it } from "vitest";

type Result = { results?: unknown[] } | undefined;

/**
 * D1 stub that dispatches on a marker substring of the SQL. Any statement the
 * test doesn't care about returns empty, so each test only declares the rows
 * it wants to assert on.
 */
function stubDb(overrides: Record<string, unknown[]>, scalars: Record<string, unknown> = {}) {
  return {
    prepare: (sql: string) => {
      const run = async () => {
        for (const [marker, rows] of Object.entries(overrides))
          if (sql.includes(marker)) return { results: rows };
        return { results: [] };
      };
      const first = async () => {
        for (const [marker, value] of Object.entries(scalars))
          if (sql.includes(marker)) return value;
        return null;
      };
      return {
        bind: () => ({
          first,
          all: async (): Promise<Result> => run(),
        }),
        first,
        all: async (): Promise<Result> => run(),
      };
    },
    batch: async (..._a: unknown[]) => {},
  } as unknown as D1Database;
}

const RATE = (purity_id: string, karat: string, rate: number) => ({
  id: `r_${purity_id}`,
  purity_id,
  karat,
  rate_cents_per_g: rate,
  effective_from: 1,
  created_at: 1,
});

const ZERO_TOTALS = { pieces: 0, net_mg: 0, fine_mg: 0, value_cents: 0 };
const ZERO_ATTENTION = {
  transfer_pending: 0,
  in_repair: 0,
  reserved: 0,
  last_movement_at: null,
  movements_24h: 0,
};

describe("priceStock", () => {
  it("uses the same rounding as stockSummary: round(net_mg * rate / 1000)", async () => {
    const { priceStock } = await import("./inventory");
    // 5000 mg at 14,000 cents/g = 70,000 cents. 4444 mg = 62,216 cents.
    expect(priceStock(5000, 14000)).toBe(70000);
    expect(priceStock(4444, 14000)).toBe(62216);
  });

  it("returns 0 for a missing rate rather than NaN", async () => {
    const { priceStock } = await import("./inventory");
    expect(priceStock(5000, undefined)).toBe(0);
  });
});

describe("inventoryInsights", () => {
  it("aggregates totals, byKarat and byBranch from in-stock rows", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      {
        "FROM products p": [
          {
            group_key: "pu22",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "22K",
            permille: 916,
            pieces: 2,
            net_mg: 5000,
            fine_mg: 4580,
          },
          {
            group_key: "pu22",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "22K",
            permille: 916,
            pieces: 3,
            net_mg: 3000,
            fine_mg: 2748,
          },
          {
            group_key: "pu18",
            branch_id: "b2",
            branch_name: "Kandy",
            karat: "18K",
            permille: 750,
            pieces: 1,
            net_mg: 2000,
            fine_mg: 1500,
          },
        ],
        "FROM gold_rates g": [RATE("pu22", "22K", 14000), RATE("pu18", "18K", 11000)],
        "status IN ('TRANSFER_PENDING'": [],
        "MAX(m.created_at)": [],
      },
      {
        "COUNT(*) FILTER": { transfer_pending: 0, in_repair: 0, reserved: 0 },
        "MAX(m.created_at)": { last: 1700000000000 },
        "COUNT(*) AS c24": { c24: 7 },
      }
    );

    const out = await inventoryInsights(db);

    expect(out.totals).toEqual({
      pieces: 6,
      net_mg: 10000,
      fine_mg: 8828,
      // 8000mg @14000 = 112000; 2000mg @11000 = 22000
      value_cents: 134000,
    });
    expect(out.byKarat).toEqual([
      {
        purity_id: "pu22",
        karat: "22K",
        permille: 916,
        pieces: 5,
        net_mg: 8000,
        fine_mg: 7328,
        value_cents: 112000,
      },
      {
        purity_id: "pu18",
        karat: "18K",
        permille: 750,
        pieces: 1,
        net_mg: 2000,
        fine_mg: 1500,
        value_cents: 22000,
      },
    ]);
    expect(out.byBranch).toEqual([
      {
        branch_id: "b1",
        name: "Colombo",
        pieces: 5,
        net_mg: 8000,
        fine_mg: 7328,
        value_cents: 112000,
      },
      {
        branch_id: "b2",
        name: "Kandy",
        pieces: 1,
        net_mg: 2000,
        fine_mg: 1500,
        value_cents: 22000,
      },
    ]);
    expect(out.attention).toEqual({
      transfer_pending: 0,
      in_repair: 0,
      reserved: 0,
      last_movement_at: 1700000000000,
      movements_24h: 7,
    });
  });

  it("prices a karat with no published rate at 0", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      {
        "FROM products p": [
          {
            group_key: "pu24",
            branch_id: "b1",
            branch_name: "Colombo",
            karat: "24K",
            permille: 999,
            pieces: 1,
            net_mg: 10000,
            fine_mg: 9990,
          },
        ],
        "FROM gold_rates g": [],
      },
      { "COUNT(*) FILTER": {}, "MAX(m.created_at)": { last: null }, "COUNT(*) AS c24": { c24: 0 } }
    );

    const out = await inventoryInsights(db);

    expect(out.totals.value_cents).toBe(0);
    expect(out.byKarat[0]!.value_cents).toBe(0);
    expect(out.byBranch[0]!.value_cents).toBe(0);
  });

  it("returns zeroed totals and empty arrays when nothing is in stock", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      { "FROM products p": [], "FROM gold_rates g": [] },
      { "COUNT(*) FILTER": {}, "MAX(m.created_at)": { last: null }, "COUNT(*) AS c24": { c24: 0 } }
    );

    expect(await inventoryInsights(db)).toEqual({
      totals: ZERO_TOTALS,
      byKarat: [],
      byBranch: [],
      attention: ZERO_ATTENTION,
    });
  });

  it("counts non-in-stock statuses into attention", async () => {
    const { inventoryInsights } = await import("./inventory");
    const db = stubDb(
      { "FROM products p": [], "FROM gold_rates g": [] },
      {
        "COUNT(*) FILTER": { transfer_pending: 4, in_repair: 2, reserved: 1 },
        "MAX(m.created_at)": { last: 5 },
        "COUNT(*) AS c24": { c24: 3 },
      }
    );

    const out = await inventoryInsights(db);

    expect(out.attention.transfer_pending).toBe(4);
    expect(out.attention.in_repair).toBe(2);
    expect(out.attention.reserved).toBe(1);
    expect(out.attention.movements_24h).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter goldos-api test -- inventory-insights`

Expected: FAIL — `Cannot find module` / no exported member `priceStock` or `inventoryInsights`.

- [ ] **Step 3: Implement `priceStock` and `inventoryInsights`**

Append to `apps/api/src/services/inventory.ts`:

```ts
export type KaratLine = {
  purity_id: string;
  karat: string;
  permille: number;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  value_cents: number;
};

export type BranchLine = {
  branch_id: string;
  name: string;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  value_cents: number;
};

export type InventoryInsights = {
  totals: { pieces: number; net_mg: number; fine_mg: number; value_cents: number };
  byKarat: KaratLine[];
  byBranch: BranchLine[];
  attention: {
    transfer_pending: number;
    in_repair: number;
    reserved: number;
    last_movement_at: number | null;
    movements_24h: number;
  };
};

/**
 * One pricing rule for every stock value in the app. Kept in the same file as
 * stockSummary so the two can never drift: if this changes, both change.
 * A karat with no published rate contributes 0, not NaN — the UI has a
 * "no priced stock" state and must keep rendering.
 */
export function priceStock(netMg: number, rateCentsPerG: number | undefined): number {
  if (!rateCentsPerG) return 0;
  return Math.round((netMg * rateCentsPerG) / 1000);
}

type InsightRow = {
  group_key: string;
  branch_id: string;
  branch_name: string;
  karat: string;
  permille: number;
  pieces: number;
  net_mg: number;
  fine_mg: number;
};

type AttentionCounts = { transfer_pending: number; in_repair: number; reserved: number };

export async function inventoryInsights(db: D1Database): Promise<InventoryInsights> {
  const [{ results: rows }, rates, counts, last, c24] = await Promise.all([
    db
      .prepare(
        `SELECT p.purity_id AS group_key, p.branch_id, b.name AS branch_name, pu.karat, pu.permille, COUNT(*) AS pieces, SUM(p.net_mg) AS net_mg, SUM(p.fine_gold_mg) AS fine_mg FROM products p JOIN purities pu ON pu.id = p.purity_id LEFT JOIN branches b ON b.id = p.branch_id WHERE p.status = 'IN_STOCK' GROUP BY p.purity_id, p.branch_id, pu.karat, pu.permille, b.name`
      )
      .all<InsightRow>(),
    currentGoldRatesCents(db),
    db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE status = 'TRANSFER_PENDING') AS transfer_pending, COUNT(*) FILTER (WHERE status = 'IN_REPAIR') AS in_repair, COUNT(*) FILTER (WHERE status = 'RESERVED') AS reserved FROM products`
      )
      .first<AttentionCounts>(),
    db
      .prepare(`SELECT MAX(created_at) AS last FROM stock_movements`)
      .first<{ last: number | null }>(),
    db
      .prepare(`SELECT COUNT(*) AS c24 FROM stock_movements WHERE created_at >= ?`)
      .bind(Date.now() - 24 * 60 * 60 * 1000)
      .first<{ c24: number }>(),
  ]);

  const byPurityRate = new Map(rates.map((r) => [r.purity_id, r.rate_cents_per_g]));
  const karat = new Map<string, KaratLine>();
  const branch = new Map<string, BranchLine>();
  const totals = { pieces: 0, net_mg: 0, fine_mg: 0, value_cents: 0 };

  for (const r of rows ?? []) {
    const rate = byPurityRate.get(r.group_key);
    const pieces = Number(r.pieces ?? 0);
    const netMg = Number(r.net_mg ?? 0);
    const fineMg = Number(r.fine_mg ?? 0);
    const valueCents = priceStock(netMg, rate);

    totals.pieces += pieces;
    totals.net_mg += netMg;
    totals.fine_mg += fineMg;
    totals.value_cents += valueCents;

    const k = karat.get(r.group_key) ?? {
      purity_id: r.group_key,
      karat: r.karat,
      permille: r.permille,
      pieces: 0,
      net_mg: 0,
      fine_mg: 0,
      value_cents: 0,
    };
    k.pieces += pieces;
    k.net_mg += netMg;
    k.fine_mg += fineMg;
    k.value_cents += valueCents;
    karat.set(r.group_key, k);

    const b = branch.get(r.branch_id) ?? {
      branch_id: r.branch_id,
      name: r.branch_name ?? r.branch_id,
      pieces: 0,
      net_mg: 0,
      fine_mg: 0,
      value_cents: 0,
    };
    b.pieces += pieces;
    b.net_mg += netMg;
    b.fine_mg += fineMg;
    b.value_cents += valueCents;
    branch.set(r.branch_id, b);
  }

  const byValue = (a: { value_cents: number }, b: { value_cents: number }) =>
    b.value_cents - a.value_cents;

  return {
    totals,
    byKarat: [...karat.values()].sort(byValue),
    byBranch: [...branch.values()].sort(byValue),
    attention: {
      transfer_pending: Number(counts?.transfer_pending ?? 0),
      in_repair: Number(counts?.in_repair ?? 0),
      reserved: Number(counts?.reserved ?? 0),
      last_movement_at: last?.last ?? null,
      movements_24h: Number(c24?.c24 ?? 0),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter goldos-api test -- inventory-insights`

Expected: PASS — 9 tests (2 `priceStock`, 5 `inventoryInsights`).

- [ ] **Step 5: Run the full API suite and typecheck**

Run: `pnpm --filter goldos-api test && pnpm --filter goldos-api lint`

Expected: all tests PASS, `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/inventory.ts apps/api/src/services/inventory-insights.test.ts
git commit -m "feat: inventory insights service with karat, branch and attention breakdown"
```

---

### Task 2: `GET /inventory/insights` route

**Files:**
- Modify: `apps/api/src/routes/inventory.ts` (insert before the final `;`)

**Interfaces:**
- Consumes: `inventoryInsights(db)` from `../services/inventory` (Task 1).
- Produces: `GET /api/v1/inventory/insights` → `{ success: true, data: InventoryInsights }`. Guarded by `requireAuth` (already `.use`d on the router) and `requirePerm(PERMISSIONS.PRODUCTS_VIEW)`.

- [ ] **Step 1: Add the route handler**

In `apps/api/src/routes/inventory.ts`, change the import on line 7 to:

```ts
import { inventoryInsights, listMovements, recordMovement, stockSummary } from "../services/inventory";
```

Then insert this handler immediately before `.get("/stock", ...)`:

```ts
  .get("/insights", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    return c.json({ success: true, data: await inventoryInsights(c.env.DB) }, 200);
  })
```

Ordering matters: `/insights` is registered before `/stock` but after `/movements`. Hono matches exact paths, so any position among the `.get()` calls is correct; keep it directly above `/stock` for readability.

- [ ] **Step 2: Verify route registration and types**

Run: `pnpm --filter goldos-api lint`

Expected: `tsc --noEmit` clean. The new handler returns a `Promise<Response>`, matching the other handlers.

- [ ] **Step 3: Verify the route is mounted**

Run: `grep -n "inventory" apps/api/src/index.ts`

Expected: the `inventory` router is mounted under `/api/v1/inventory`. If it is mounted under a different prefix, record that prefix — Step 5 of Task 8 depends on it.

- [ ] **Step 4: Run the API suite for regressions**

Run: `pnpm --filter goldos-api test`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/inventory.ts
git commit -m "feat: expose GET /inventory/insights"
```

---

### Task 3: `lib/count-up.ts` + dashboard import

**Files:**
- Create: `apps/web/lib/count-up.ts`
- Modify: `apps/web/app/(app)/dashboard/page.tsx:64-84` (delete local `useCountUp`), add an import

**Interfaces:**
- Consumes: nothing.
- Produces: `export function useCountUp(target: number | undefined, ms?: number): number` — animates `target` from 0 with an ease-out cubic over `ms` (default 1100). Snaps immediately when `target` is `undefined`… no: when `target` is `undefined` it returns `0` without starting a rAF loop, and snaps to the target instantly under `prefers-reduced-motion`.

- [ ] **Step 1: Create the hook**

Create `apps/web/lib/count-up.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * Counts from 0 to `target` with an ease-out cubic over `ms`.
 * Returns 0 while `target` is undefined (still loading) so callers can
 * render a placeholder instead of a number they do not have yet.
 */
export function useCountUp(target: number | undefined, ms = 1100): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === undefined) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
```

- [ ] **Step 2: Delete the duplicate from the dashboard**

In `apps/web/app/(app)/dashboard/page.tsx`, delete the whole `useCountUp` function (from `function useCountUp(target: number | undefined, ms = 1100): number {` through its closing `}`), and add to the imports:

```ts
import { useCountUp } from "@/lib/count-up";
```

Do not change any call site — the signature is identical, so `d.salesToday.data ? d.salesToday.data.value_cents / 100 : undefined` and similar continue to work.

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter goldos-web lint`

Expected: clean. `useState`/`useEffect` are still used elsewhere in the dashboard, so the existing `react` import stays.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/count-up.ts "apps/web/app/(app)/dashboard/page.tsx"
git commit -m "refactor: hoist useCountUp out of the dashboard into lib/count-up"
```

---

### Task 4: Chart primitives — `BarList`, `GaugeRing`, `MetricCard`

**Files:**
- Modify: `apps/web/components/ui.tsx` (append at end of file)

**Interfaces:**
- Consumes: `useCountUp` from `@/lib/count-up` (Task 3); `cn` from `@/lib/cn`; `ArrowRightIcon` from `./icons` (already imported).
- Produces:
  ```ts
  export function BarList({ items, ramp?, format, empty? }: {
    items: ReadonlyArray<{ key: string; label: ReactNode; value: number; secondary?: ReactNode; href?: string }>;
    ramp?: Maybe<"gold" | "ink">;
    format: (n: number) => string;
    empty?: ReactNode;
  }): React.JSX.Element;

  export function GaugeRing({ value, max, caption, label }: {
    value: number; max: number; caption: ReactNode; label?: ReactNode;
  }): React.JSX.Element;

  export function MetricCard({ label, value, format, unit?, prefix?, sub?, icon, href?, loading? }: {
    label: ReactNode; value: number | undefined; format: (n: number) => string;
    unit?: ReactNode; prefix?: ReactNode; sub?: ReactNode; icon: ReactNode;
    href?: Maybe<string>; loading?: Maybe<boolean>;
  }): React.JSX.Element;
  ```

- [ ] **Step 1: Append the three components to `ui.tsx`**

Append to `apps/web/components/ui.tsx`. First add `useCountUp` to the imports at the top:

```ts
import { useCountUp } from "@/lib/count-up";
```

Then append:

```tsx
/* ---------------------------------------------------------------- Charts */

const RAMP_FILL: Record<"gold" | "ink", string> = {
  gold: "bg-gradient-to-r from-gold-deep via-gold to-gold-light",
  ink: "bg-gradient-to-r from-ink-2 via-ink-3 to-gold-dark",
};

/**
 * Horizontal bar rows scaled to the largest value in the set. Each fill
 * animates in on mount with a per-row delay, and collapses instantly under
 * prefers-reduced-motion. Values are formatted by the caller so this never
 * hardcodes grams or currency.
 */
export function BarList({
  items,
  ramp = "gold",
  format,
  empty,
}: {
  items: ReadonlyArray<{
    key: string;
    label: ReactNode;
    value: number;
    secondary?: ReactNode;
    href?: string;
  }>;
  ramp?: Maybe<"gold" | "ink">;
  format: (n: number) => string;
  empty?: ReactNode;
}) {
  if (items.length === 0) return <>{empty ?? null}</>;
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const pct = Math.max(0, Math.min(100, (it.value / max) * 100));
        const inner = (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="g-metric min-w-0 truncate text-xs font-semibold text-paper/85">
                {it.label}
              </span>
              <span className="g-metric shrink-0 text-xs text-paper">{format(it.value)}</span>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-paper/[0.06]">
              <div
                className={cn("h-full rounded-full motion-reduce:transition-none", RAMP_FILL[ramp])}
                style={{
                  width: `${pct}%`,
                  transition: `width 900ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 60}ms`,
                }}
              />
            </div>
            {it.secondary ? (
              <div className="mt-2 truncate text-[11px] text-paper/40">{it.secondary}</div>
            ) : null}
          </>
        );
        const cls =
          "group block rounded-xl bg-paper/[0.03] p-3 ring-1 ring-paper/[0.06] transition-colors hover:bg-paper/[0.06]";
        return (
          <li key={it.key}>
            {it.href ? (
              <Link href={it.href} className={cls}>
                {inner}
              </Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * SVG donut gauge with rotating tick marks and a gold-gradient arc. Decorative:
 * it is aria-hidden and the value is always carried by `caption` as text, so
 * the number is never chart-only.
 */
export function GaugeRing({
  value,
  max,
  caption,
  label,
}: {
  value: number;
  max: number;
  caption: ReactNode;
  label?: ReactNode;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 120);
    return () => clearTimeout(t);
  }, [value]);
  const r = 70;
  const len = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, shown / max)) : 0;
  return (
    <div className="relative size-full" aria-hidden>
      <svg viewBox="0 0 200 200" className="size-full">
        <defs>
          <linearGradient id="gr-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFF4C7" />
            <stop offset="0.45" stopColor="#E7C65A" />
            <stop offset="1" stopColor="#A8861B" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="94" fill="none" stroke="rgba(231,198,90,0.3)" strokeDasharray="1.5 6" />
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke="url(#gr-arc)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - pct)}
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "100px 100px",
            transition: "stroke-dashoffset 1400ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-paper/40 sm:text-[9px]">
          {label}
        </span>
        <span className="g-metric mt-1 text-lg text-paper sm:text-2xl">{caption}</span>
      </div>
    </div>
  );
}

/**
 * Spotlight stat tile: gold-gradient icon chip, count-up value, and a gold
 * underline that sweeps in on hover. `value === undefined` renders a dash
 * without animating, so a failed query never shows a misleading 0.
 */
export function MetricCard({
  label,
  value,
  format,
  unit,
  prefix,
  sub,
  icon,
  href,
  loading,
}: {
  label: ReactNode;
  value: number | undefined;
  format: (n: number) => string;
  unit?: ReactNode;
  prefix?: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  href?: Maybe<string>;
  loading?: Maybe<boolean>;
}) {
  const shown = useCountUp(value);
  const body = (
    <div className="relative flex h-full flex-col p-5">
      <div className="flex items-center gap-2.5 text-sm font-medium text-ink-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)] transition-all duration-320 group-hover:from-void group-hover:to-ink-2 group-hover:text-gold-light">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-6">
        {loading || value === undefined ? (
          <Skeleton className="h-9 w-28" />
        ) : (
          <div className="flex items-baseline gap-1.5">
            {prefix ? <span className="text-xs font-medium text-ink-4">{prefix}</span> : null}
            <span className="g-metric truncate text-3xl leading-none text-ink">{format(shown)}</span>
            {unit ? <span className="text-sm font-medium text-ink-4">{unit}</span> : null}
          </div>
        )}
        {sub ? <p className="mt-2 truncate text-xs text-ink-4">{sub}</p> : null}
      </div>
      <span className="absolute inset-x-5 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-transparent transition-transform duration-500 ease-brand group-hover:scale-x-100" />
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="group block h-full rounded-[22px]">
        <SpotlightCard tone="light">{body}</SpotlightCard>
      </Link>
    );
  }
  return (
    <div className="group block h-full rounded-[22px]">
      <SpotlightCard tone="light">{body}</SpotlightCard>
    </div>
  );
}
```

- [ ] **Step 2: Add the missing imports**

The new components need `useState`, `useEffect`, and `SpotlightCard`. Update the first import line of `apps/web/components/ui.tsx` to:

```ts
import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
```

And add after the `./icons` import:

```ts
import { SpotlightCard } from "./home/motion";
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter goldos-web lint`

Expected: clean. All 25 importing pages are in the same TypeScript program, so this also proves the additive change broke nothing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui.tsx
git commit -m "feat: add BarList, GaugeRing and MetricCard primitives"
```

---

### Task 5: Table and form primitives — `DataTable`, `FilterChips`, `Field`

**Files:**
- Modify: `apps/web/components/ui.tsx` (append at end of file)

**Interfaces:**
- Consumes: `cn`; `TableSkeleton` and `EmptyBlock` from this same file.
- Produces:
  ```ts
  export type DataColumn<R> = {
    key: string; label: ReactNode; align?: Maybe<"left" | "right">;
    width?: Maybe<string>; render: (row: R) => ReactNode;
    sortable?: Maybe<boolean>; value?: (row: R) => number | string;
  };
  export function DataTable<R>({ columns, rows, rowKey, sort, onSort, totals, onRowClick, loading, empty, caption }: {
    columns: ReadonlyArray<DataColumn<R>>;
    rows: ReadonlyArray<R>;
    rowKey: (row: R) => string;
    sort?: Maybe<{ key: string; dir: "asc" | "desc" }>;
    onSort?: (key: string) => void;
    totals?: ReactNode;
    onRowClick?: (row: R) => void;
    loading?: Maybe<boolean>;
    empty?: ReactNode;
    caption?: ReactNode;
  }): React.JSX.Element;
  export function FilterChips({ options, value, onChange, ariaLabel }: {
    options: ReadonlyArray<{ key: string; label: ReactNode; count?: Maybe<number> }>;
    value: string; onChange: (key: string) => void; ariaLabel?: Maybe<string>;
  }): React.JSX.Element;
  export function Field({ label, hint, error, htmlFor, children }: {
    label: ReactNode; hint?: ReactNode; error?: ReactNode;
    htmlFor: string; children: ReactNode;
  }): React.JSX.Element;
  ```

  Sorting state is owned by the caller, not by `DataTable`. `onSort` receives only the key; the caller decides direction. This keeps the component usable for server-paged tables later.

- [ ] **Step 1: Append the three components**

Append to `apps/web/components/ui.tsx`:

```tsx
/* ---------------------------------------------------------------- Tables (typed) */

export type DataColumn<R> = {
  key: string;
  label: ReactNode;
  align?: Maybe<"left" | "right">;
  width?: Maybe<string>;
  render: (row: R) => ReactNode;
  sortable?: Maybe<boolean>;
  value?: (row: R) => number | string;
};

const ALIGN = { left: "!text-left", right: "!text-right num" } as const;

/**
 * Typed table with a sticky header. Sort state is owned by the caller via
 * `sort`/`onSort`, so the same component serves a client-sorted stock table
 * and a server-paged movement ledger without change. Keeps `g-table` styling.
 */
export function DataTable<R>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  totals,
  onRowClick,
  loading,
  empty,
  caption,
}: {
  columns: ReadonlyArray<DataColumn<R>>;
  rows: ReadonlyArray<R>;
  rowKey: (row: R) => string;
  sort?: Maybe<{ key: string; dir: "asc" | "desc" }>;
  onSort?: (key: string) => void;
  totals?: ReactNode;
  onRowClick?: (row: R) => void;
  loading?: Maybe<boolean>;
  empty?: ReactNode;
  caption?: ReactNode;
}) {
  if (loading) return <TableSkeleton rows={6} cols={Math.min(columns.length, 6)} />;
  if (rows.length === 0) return <>{empty ?? <EmptyBlock title="Nothing to show" />}</>;

  return (
    <div className="relative">
      <div className="max-h-[32rem] overflow-auto scrollbar-thin">
        <table className="g-table">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="sticky top-0 z-10 bg-paper">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const head = (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      c.align === "right" && "flex-row-reverse"
                    )}
                  >
                    {c.label}
                    {c.sortable ? (
                      <span className={cn("text-[9px]", active ? "text-gold-dark" : "text-ink-5")}>
                        {active && sort.dir === "asc" ? "▲" : "▼"}
                      </span>
                    ) : null}
                  </span>
                );
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={ALIGN[c.align ?? "left"]}
                    aria-sort={c.sortable ? (active ? (sort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                  >
                    {c.sortable && onSort ? (
                      <button type="button" onClick={() => onSort(c.key)} className="g-sort-btn">
                        {head}
                      </button>
                    ) : (
                      head
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn(onRowClick && "cursor-pointer")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totals ? (
        <div className="border-t border-ink/[0.07] bg-bone/60 px-5 py-3 sm:px-6">{totals}</div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Filter chips */

export function FilterChips({
  options,
  value,
  onChange,
  ariaLabel = "Filters",
}: {
  options: ReadonlyArray<{ key: string; label: ReactNode; count?: Maybe<number> }>;
  value: string;
  onChange: (key: string) => void;
  ariaLabel?: Maybe<string>;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "g-btn h-8 px-3 text-xs transition-colors",
              active ? "g-btn-primary" : "g-btn-secondary"
            )}
          >
            {o.label}
            {o.count != null ? <span className="ml-1 num-tabular opacity-70">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Form field */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink-3">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-ink-4">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add the `g-sort-btn` class to the stylesheet**

In `apps/web/app/globals.css`, inside the `@layer components` block that starts at line 60, append after the `.g-table .num` rule (line 263):

```css
  .g-sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  .g-sort-btn:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px #1c1917, 0 0 0 3px rgba(201, 162, 39, 0.3);
    border-radius: 0.25rem;
  }
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter goldos-web lint`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui.tsx apps/web/app/globals.css
git commit -m "feat: add DataTable, FilterChips and Field primitives"
```

---

### Task 6: `columns.tsx` — table descriptors and shared types

**Files:**
- Create: `apps/web/app/(app)/inventory/columns.tsx`

**Interfaces:**
- Consumes: `DataColumn` from `@/components/ui`; `mgToG`, `centsToLkr` from `@goldos/shared`; icons from `@/components/icons`.
- Produces:
  ```ts
  export type StockRow = { key: string; pieces: number; net_mg: number; fine_mg: number; value_cents: number | null };
  export type Movement = {
    id: string; product_id: string; barcode: string | null; type: string;
    from_status: string | null; to_status: string; from_branch: string | null;
    to_branch: string | null; weight_mg: number; reason: string | null; created_at: number;
  };
  export type Insights = {
    totals: { pieces: number; net_mg: number; fine_mg: number; value_cents: number };
    byKarat: Array<{ purity_id: string; karat: string; permille: number; pieces: number; net_mg: number; fine_mg: number; value_cents: number }>;
    byBranch: Array<{ branch_id: string; name: string; pieces: number; net_mg: number; fine_mg: number; value_cents: number }>;
    attention: { transfer_pending: number; in_repair: number; reserved: number; last_movement_at: number | null; movements_24h: number };
  };
  export type Piece = { product: { id: string; barcode: string; name: string; status: string; branch_id: string; net_mg: number; fine_gold_mg: number; cost_cents: number; karat: string; permille: number } };
  export const MOVEMENT_TYPES: ReadonlyArray<{ key: string; label: string }>;
  export function MovementTypeIcon({ type }: { type: string }): React.JSX.Element;
  export function movementTypeMeta(type: string): { label: string; icon: ReactNode };
  export function stockColumns(groupBy: "branch" | "purity" | "product"): ReadonlyArray<DataColumn<StockRow>>;
  export function movementColumns(branchName: (id: string | null) => string): ReadonlyArray<DataColumn<Movement>>;
  export function fineShareBar(ratio: number): React.JSX.Element;
  ```

- [ ] **Step 1: Create the file**

Create `apps/web/app/(app)/inventory/columns.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { centsToLkr, mgToG } from "@goldos/shared";
import { cn } from "@/lib/cn";
import { StatusPill, type DataColumn } from "@/components/ui";
import {
  ArrowLeftRightIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  CircleSlashIcon,
  PackagePlusIcon,
  TruckIcon,
} from "@/components/icons";

export type StockRow = {
  key: string;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  value_cents: number | null;
};

export type Movement = {
  id: string;
  product_id: string;
  barcode: string | null;
  type: string;
  from_status: string | null;
  to_status: string;
  from_branch: string | null;
  to_branch: string | null;
  weight_mg: number;
  reason: string | null;
  created_at: number;
};

export type Insights = {
  totals: { pieces: number; net_mg: number; fine_mg: number; value_cents: number };
  byKarat: Array<{
    purity_id: string;
    karat: string;
    permille: number;
    pieces: number;
    net_mg: number;
    fine_mg: number;
    value_cents: number;
  }>;
  byBranch: Array<{
    branch_id: string;
    name: string;
    pieces: number;
    net_mg: number;
    fine_mg: number;
    value_cents: number;
  }>;
  attention: {
    transfer_pending: number;
    in_repair: number;
    reserved: number;
    last_movement_at: number | null;
    movements_24h: number;
  };
};

export type Piece = {
  product: {
    id: string;
    barcode: string;
    name: string;
    status: string;
    branch_id: string;
    net_mg: number;
    fine_gold_mg: number;
    cost_cents: number;
    karat: string;
    permille: number;
  };
};

export const MOVEMENT_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "INTAKE", label: "Intake" },
  { key: "TRANSFER_OUT", label: "Transfer out" },
  { key: "TRANSFER_IN", label: "Transfer in" },
  { key: "RETURN", label: "Return" },
  { key: "LOSS", label: "Loss" },
  { key: "VOID", label: "Void" },
];

const TYPE_TONE: Record<string, string> = {
  INTAKE: "bg-emerald-700/10 text-emerald-700",
  TRANSFER_OUT: "bg-gold/15 text-gold-dark",
  TRANSFER_IN: "bg-gold/15 text-gold-dark",
  RETURN: "bg-sky-700/10 text-sky-700",
  LOSS: "bg-rose-700/10 text-rose-700",
  VOID: "bg-ink/[0.08] text-ink-3",
  SALE_OUT: "bg-indigo-700/10 text-indigo-700",
};

const TYPE_ICON: Record<string, ReactNode> = {
  INTAKE: <PackagePlusIcon size={13} />,
  TRANSFER_OUT: <TruckIcon size={13} />,
  TRANSFER_IN: <TruckIcon size={13} />,
  RETURN: <ArrowUturnLeftIcon size={13} />,
  LOSS: <CircleSlashIcon size={13} />,
  VOID: <ArrowLeftRightIcon size={13} />,
  SALE_OUT: <CheckCircleIcon size={13} />,
};

export function movementTypeMeta(type: string): { label: string; icon: ReactNode } {
  return {
    label: type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    icon: TYPE_ICON[type] ?? <ArrowLeftRightIcon size={13} />,
  };
}

export function MovementTypeIcon({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg",
        TYPE_TONE[type] ?? "bg-ink/[0.06] text-ink-3"
      )}
    >
      {TYPE_ICON[type] ?? <ArrowLeftRightIcon size={13} />}
    </span>
  );
}

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
const rupees = (cents: number) => `LKR ${centsToLkr(cents).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** 1px track with a gold fill, used inline in table cells. */
export function fineShareBar(ratio: number) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <span className="flex items-center gap-2">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-ink/10">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

export function stockColumns(groupBy: "branch" | "purity" | "product"): ReadonlyArray<DataColumn<StockRow>> {
  const firstLabel =
    groupBy === "branch" ? "Branch" : groupBy === "purity" ? "Purity" : "Product";

  return [
    {
      key: "key",
      label: firstLabel,
      sortable: true,
      value: (r) => r.key,
      render: (r) => <span className="font-mono text-xs text-ink">{r.key}</span>,
    },
    {
      key: "pieces",
      label: "Pieces",
      align: "right",
      sortable: true,
      value: (r) => r.pieces,
      render: (r) => <span className="g-metric">{r.pieces.toLocaleString("en-US")}</span>,
    },
    {
      key: "net_mg",
      label: "Net g",
      align: "right",
      sortable: true,
      value: (r) => r.net_mg,
      render: (r) => grams(r.net_mg),
    },
    {
      key: "fine_mg",
      label: "Fine g",
      align: "right",
      sortable: true,
      value: (r) => r.fine_mg,
      render: (r) => (
        <span className="flex items-center justify-end gap-2">
          {fineShareBar(r.net_mg > 0 ? r.fine_mg / r.net_mg : 0)}
          <span>{grams(r.fine_mg)}</span>
        </span>
      ),
    },
    {
      key: "value_cents",
      label: "Value",
      align: "right",
      sortable: true,
      value: (r) => r.value_cents ?? -1,
      render: (r) =>
        r.value_cents === null ? <span className="text-ink-5">—</span> : rupees(r.value_cents),
    },
  ];
}

export function movementColumns(
  branchName: (id: string | null) => string
): ReadonlyArray<DataColumn<Movement>> {
  return [
    {
      key: "type",
      label: "Type",
      width: "12rem",
      sortable: true,
      value: (m) => m.type,
      render: (m) => (
        <span className="flex items-center gap-2.5">
          <MovementTypeIcon type={m.type} />
          <span className="text-xs font-medium text-ink">{movementTypeMeta(m.type).label}</span>
        </span>
      ),
    },
    {
      key: "barcode",
      label: "Barcode",
      sortable: true,
      value: (m) => m.barcode ?? m.product_id,
      render: (m) => (
        <span className="font-mono text-xs text-ink-3">{m.barcode ?? m.product_id.slice(0, 8)}</span>
      ),
    },
    {
      key: "transition",
      label: "From → To",
      render: (m) => (
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <span>{m.from_status ?? "—"}</span>
          <span className="text-ink-5">→</span>
          <StatusPill status={m.to_status} />
        </span>
      ),
    },
    {
      key: "branch",
      label: "Branch",
      render: (m) => (
        <span className="text-xs text-ink-4">{branchName(m.to_branch ?? m.from_branch)}</span>
      ),
    },
    {
      key: "weight_mg",
      label: "Weight g",
      align: "right",
      sortable: true,
      value: (m) => m.weight_mg,
      render: (m) => grams(m.weight_mg),
    },
    {
      key: "reason",
      label: "Reason",
      render: (m) => <span className="text-ink-3">{m.reason ?? "—"}</span>,
    },
    {
      key: "created_at",
      label: "Time",
      align: "right",
      sortable: true,
      value: (m) => m.created_at,
      render: (m) => (
        <span className="text-xs text-ink-4">{new Date(m.created_at).toLocaleString()}</span>
      ),
    },
  ];
}
```

- [ ] **Step 2: Add the five missing icons**

`columns.tsx` imports five icons that do not exist yet. Append to `apps/web/components/icons.tsx`. This file has a local convention every icon follows: a `base(props)` helper (lines 7-20) supplies width, height, viewBox, stroke and className, and each icon is a named function spreading it. Follow it exactly — do not write inline `<svg>` attributes.

```tsx
export function PackagePlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M16.5 9.4 7.55 4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05" />
      <path d="M12 22.08V12" />
    </svg>
  );
}

export function ArrowUturnLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function CircleSlashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </svg>
  );
}

export function ArrowLeftRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}
```

- [ ] **Step 3: Typecheck the web app**

Run: `pnpm --filter goldos-web lint`

Expected: clean. This task has no page consuming `columns.tsx` yet, so an unused-export warning is not an error under this tsconfig; if it is, add `"noUnusedLocals": false` reasoning to the plan rather than deleting the exports — Tasks 8 and 9 consume them.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(app)/inventory/columns.tsx" apps/web/components/icons.tsx
git commit -m "feat: inventory table column descriptors and movement type icons"
```

---

### Task 7: `panels.tsx` — hero, charts, alerts, scan preview, filters

**Files:**
- Create: `apps/web/app/(app)/inventory/panels.tsx`

**Interfaces:**
- Consumes: `BarList`, `GaugeRing`, `FilterChips`, `Field`, `StatusPill`, `Callout`, `EmptyBlock`, `Skeleton`, `controlClass`, `controlSmClass`, `heroBtnGold`-style classes from `@/components/ui`; `SpotlightCard` from `@/components/home/motion`; `Insights`, `Piece`, `movementTypeMeta` from `./columns`; `api` from `@/lib/api`; `useCountUp` from `@/lib/count-up`; `mgToG`, `centsToLkr` from `@goldos/shared`.
- Produces:
  ```ts
  export function InventoryHero({ insights, loading, error, onRecord }: {
    insights?: Insights; loading: boolean; error?: string; onRecord: () => void;
  }): React.JSX.Element;
  export function StockByKarat({ data, loading, error, onRetry }: {
    data?: Insights; loading: boolean; error?: string; onRetry: () => void;
  }): React.JSX.Element;
  export function StockByBranch({ data, loading, error, onRetry }: {
    data?: Insights; loading: boolean; error?: string; onRetry: () => void;
  }): React.JSX.Element;
  export function AttentionCard({ data, loading, error, onRetry, onFilter }: {
    data?: Insights; loading: boolean; error?: string;
    onRetry: () => void; onFilter: (type: string) => void;
  }): React.JSX.Element;
  export function QueryError({ message, onRetry, dark }: {
    message: string; onRetry: () => void; dark?: boolean;
  }): React.JSX.Element;
  export function PiecePreview({ code }: { code: string }): React.JSX.Element;
  export function MovementFilters({ type, branch, search, onType, onBranch, onSearch, branches }: {
    type: string; branch: string; search: string;
    onType: (t: string) => void; onBranch: (b: string) => void; onSearch: (s: string) => void;
    branches: Array<{ id: string; name: string }>;
  }): React.JSX.Element;
  export function PieceDetail({ piece, onClose, onMove }: {
    piece: Piece; onClose: () => void; onMove: (barcode: string) => void;
  }): React.JSX.Element;
  ```

- [ ] **Step 1: Create the file**

Create `apps/web/app/(app)/inventory/panels.tsx`:

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { centsToLkr, mgToG } from "@goldos/shared";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useCountUp } from "@/lib/count-up";
import { SpotlightCard } from "@/components/home/motion";
import {
  BarList,
  Callout,
  controlSmClass,
  Field,
  FilterChips,
  GaugeRing,
  Skeleton,
  StatusPill,
} from "@/components/ui";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  GemIcon,
  PackageIcon,
  RefreshCwIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  SearchIcon,
} from "@/components/icons";
import { MOVEMENT_TYPES, type Insights, type Piece } from "./columns";

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
const rupees = (cents: number) =>
  `LKR ${centsToLkr(cents).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const HERO_GRID =
  "pointer-events-none absolute inset-0 home-grid-bg opacity-70";

/* ---------------------------------------------------------------- Hero */

export function InventoryHero({
  insights,
  loading,
  error,
  onRecord,
}: {
  insights?: Insights;
  loading: boolean;
  error?: string;
  onRecord: () => void;
}) {
  const t = insights?.totals;
  const value = t?.value_cents ?? 0;
  const topKarat = insights?.byKarat[0];
  const target = topKarat?.value_cents ?? 0;
  const hasValue = value > 0;
  const shown = useCountUp(hasValue ? centsToLkr(value) : 0);

  // An error must not render as "0 pieces" — that reads as a real, wrong
  // number to whoever is looking for their gold.
  const dash = loading || error;
  const strip: Array<{ label: string; value: string; icon: ReactNode }> = [
    {
      label: "Pieces on hand",
      value: dash ? "—" : (t?.pieces ?? 0).toLocaleString("en-US"),
      icon: <PackageIcon size={14} />,
    },
    {
      label: "Net weight",
      value: dash ? "—" : `${grams(t?.net_mg ?? 0)} g`,
      icon: <ScaleIcon size={14} />,
    },
    {
      label: "Fine gold",
      value: dash ? "—" : `${grams(t?.fine_mg ?? 0)} g`,
      icon: <GemIcon size={14} />,
    },
    {
      label: "Stock value",
      value: dash
        ? "—"
        : hasValue
          ? rupees(value)
          : "No priced stock",
      icon: <ArchiveIcon size={14} />,
    },
  ];

  return (
    <section className="relative overflow-hidden rounded-3xl bg-void text-paper shadow-5">
      <div className={HERO_GRID} aria-hidden />
      <div className="home-drift pointer-events-none absolute -right-32 -top-40 size-[30rem] rounded-full bg-gold/20 blur-[120px]" aria-hidden />
      <div
        className="home-drift pointer-events-none absolute -bottom-48 left-10 size-[26rem] rounded-full bg-gold-deep/25 blur-[120px]"
        style={{ animationDelay: "-8s" }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" aria-hidden />

      <div className="relative grid grid-cols-1 items-center gap-8 p-5 sm:p-8 lg:grid-cols-[1.35fr_1fr] lg:p-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  error ? "bg-rose-400" : "animate-pulse-soft bg-gold"
                )}
              />
              {error ? "Data unavailable" : "Inventory"}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-paper/40">
              {new Date().toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>

          <h1 className="g-display mt-5 text-4xl text-paper text-balance sm:text-5xl">
            Every gram, <span className="home-gold-text">accounted for.</span>
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-paper/60 sm:text-[15px]">
            Stock on hand, where it sits, what it is worth, and what still needs a decision.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link href="/scan" className="home-btn-gold h-11 px-5 text-sm">
              <ScanBarcodeIcon size={15} />
              Scan to move stock
            </Link>
            <button type="button" onClick={onRecord} className="home-btn-ghost h-11 px-5 text-sm">
              Record movement
              <ArrowRightIcon size={14} />
            </button>
          </div>
        </div>

        <div className="home-glass relative flex min-w-0 items-center gap-4 p-4 sm:gap-5 sm:p-6">
          <div className="relative size-24 shrink-0 sm:size-36">
            {loading ? (
              <Skeleton className="size-full rounded-full bg-paper/10" />
            ) : (
              <GaugeRing
                value={hasValue ? centsToLkr(value) : 0}
                max={target > 0 ? centsToLkr(target) : 0}
                label={hasValue ? `Top ${topKarat?.karat}` : "Unpriced"}
                caption={hasValue ? rupees(Math.round(shown)) : "—"}
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light/80">
              Stock on hand
            </div>
            {loading ? (
              <Skeleton className="mt-2 h-9 w-36 bg-paper/10" />
            ) : (
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-xs text-paper/50">LKR</span>
                <span className="g-metric truncate text-2xl text-paper sm:text-4xl">
                  {hasValue ? Math.round(shown).toLocaleString("en-US") : "—"}
                </span>
              </div>
            )}
            <p className="mt-3 text-xs text-paper/55">
              {error
                ? error
                : hasValue
                  ? `${grams(t?.fine_mg ?? 0)} g of fine gold across ${(t?.pieces ?? 0).toLocaleString("en-US")} pieces`
                  : "Publish board rates to value your stock."}
            </p>
            {error ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-gold-light transition-colors hover:text-paper"
              >
                <RefreshCwIcon size={12} />
                Reload
              </button>
            ) : !hasValue && !loading ? (
              <Link
                href="/gold-rates"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gold-light transition-colors hover:text-paper"
              >
                Set rates <ArrowRightIcon size={12} />
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 border-t border-paper/[0.08] lg:grid-cols-4">
        {strip.map((s, i) => (
          <div
            key={s.label}
            className={cn(
              "group flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:bg-paper/[0.03] sm:px-6 lg:px-8",
              i % 2 === 1 && "border-l border-paper/[0.08]",
              i >= 2 && "border-t border-paper/[0.08] lg:border-t-0",
              i === 2 && "lg:border-l"
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper/[0.05] text-gold-light ring-1 ring-paper/[0.08] transition-colors group-hover:bg-gold group-hover:text-void">
              {s.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">
                {s.label}
              </span>
              <span className="g-metric mt-0.5 block truncate text-base text-paper">{s.value}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Charts */

/**
 * Error state for a panel. A failed insights query must not read as "no
 * stock" — it reads as "we could not load this", with a way to retry just
 * that one query.
 */
export function QueryError({
  message,
  onRetry,
  dark,
}: {
  message: string;
  onRetry: () => void;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl px-6 py-8 text-center",
        dark
          ? "border border-dashed border-paper/15 bg-paper/[0.02]"
          : "border border-dashed border-ink/[0.12] bg-bone/60"
      )}
      role="alert"
    >
      <span
        className={cn(
          "mb-3 flex size-10 items-center justify-center rounded-xl",
          dark ? "bg-paper/[0.06] text-gold-light" : "bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)]"
        )}
      >
        <AlertCircleIcon size={18} />
      </span>
      <p className={cn("text-sm font-medium", dark ? "text-paper" : "text-ink")}>
        Could not load this
      </p>
      <p className={cn("mt-1 max-w-[18rem] text-xs", dark ? "text-paper/50" : "text-ink-4")}>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "g-btn mt-4 h-9 px-3.5 text-xs",
          dark
            ? "bg-paper/10 text-paper ring-1 ring-paper/15 hover:bg-paper/[0.16]"
            : "g-btn-secondary"
        )}
      >
        <RefreshCwIcon size={13} />
        Retry
      </button>
    </div>
  );
}

function DarkEmpty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-paper/15 bg-paper/[0.02] px-6 py-9 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper/[0.06] text-gold-light">
        <GemIcon size={18} />
      </span>
      <p className="text-sm font-medium text-paper">{title}</p>
      <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-paper/50">{desc}</p>
    </div>
  );
}

function LightEmpty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink/[0.12] bg-bone/60 px-6 py-9 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)]">
        <GemIcon size={18} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-ink-4">{desc}</p>
    </div>
  );
}

export function StockByKarat({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: Insights;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const rows = data?.byKarat ?? [];
  const totalFine = rows.reduce((s, r) => s + r.fine_mg, 0);
  return (
    <section className="relative flex flex-col overflow-hidden rounded-2xl bg-void p-5 text-paper shadow-4 sm:p-6">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="home-drift pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gold/20 blur-[90px]" aria-hidden />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <GemIcon size={16} />
          </span>
          <div>
            <h2 className="font-sans text-[15px] font-semibold tracking-normal text-paper">
              Stock by karat
            </h2>
            <p className="text-xs text-paper/45">
              {loading ? "Loading" : `${grams(totalFine)} g fine gold`}
            </p>
          </div>
        </div>
      </div>

      <div className="relative mt-5 flex-1">
        {error ? (
          <QueryError dark message={error} onRetry={onRetry} />
        ) : loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-xl bg-paper/10" />
            ))}
          </div>
        ) : (
          <BarList
            items={rows.map((r) => ({
              key: r.purity_id,
              label: r.karat,
              value: r.fine_mg,
              secondary: `${r.pieces} pieces · ${grams(r.net_mg)} g net · ${rupees(r.value_cents)}`,
            }))}
            format={grams}
            empty={
              <DarkEmpty
                title="No stock on hand"
                desc="Intake a purchase or run a count to build up stock."
              />
            }
          />
        )}
      </div>
    </section>
  );
}

export function StockByBranch({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: Insights;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const rows = (data?.byBranch ?? []).slice(0, 10);
  const hidden = (data?.byBranch.length ?? 0) - rows.length;
  return (
    <section className="relative flex flex-col overflow-hidden rounded-2xl p-5 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_18px_40px_-28px_rgba(28,25,23,0.25)] sm:p-6">
      <SpotlightCard tone="light" className="flex flex-1 flex-col">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)]">
            <Building2Icon size={16} />
          </span>
          <div>
            <h2 className="font-sans text-[15px] font-semibold tracking-normal text-ink">
              Stock by branch
            </h2>
            <p className="text-xs text-ink-4">Where the metal is sitting right now</p>
          </div>
        </div>

        <div className="mt-5 flex-1">
          {error ? (
            <QueryError message={error} onRetry={onRetry} />
          ) : loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : (
            <BarList
              items={rows.map((r) => ({
                key: r.branch_id,
                label: r.name,
                value: r.net_mg,
                secondary: `${r.pieces} pieces · ${rupees(r.value_cents)}`,
                href: "/products",
              }))}
              ramp="ink"
              format={grams}
              empty={
                <LightEmpty
                  title="No stock on hand"
                  desc="Nothing is in stock at any branch."
                />
              }
            />
          )}
        </div>

        {hidden > 0 && !loading ? (
          <p className="mt-4 text-xs text-ink-4">and {hidden} more branches</p>
        ) : null}
      </SpotlightCard>
    </section>
  );
}

/* ---------------------------------------------------------------- Attention */

type AlertRow = {
  key: string;
  count: number;
  label: string;
  tone: "warning" | "info" | "neutral";
  onClick: () => void;
};

const ALERT_TONE = {
  warning: "bg-amber-50/60 ring-amber-600/10 hover:bg-amber-50",
  info: "bg-gold/[0.07] ring-gold/20 hover:bg-gold/[0.12]",
  neutral: "bg-bone ring-ink/[0.06] hover:bg-ink/[0.04]",
} as const;

const ALERT_DOT = {
  warning: "bg-amber-500",
  info: "bg-gold",
  neutral: "bg-ink-4",
} as const;

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function AttentionCard({
  data,
  loading,
  error,
  onRetry,
  onFilter,
}: {
  data?: Insights;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onFilter: (type: string) => void;
}) {
  const a = data?.attention;
  const last = a?.last_movement_at ?? null;
  const quiet = last === null || Date.now() - last > STALE_AFTER_MS;

  const rows: AlertRow[] = [];
  if (a?.transfer_pending)
    rows.push({
      key: "pending",
      count: a.transfer_pending,
      label: "pieces in transit",
      tone: "warning",
      onClick: () => onFilter("TRANSFER_OUT"),
    });
  if (a?.in_repair)
    rows.push({
      key: "repair",
      count: a.in_repair,
      label: "pieces in repair",
      tone: "info",
      onClick: () => onFilter("TRANSFER_IN"),
    });
  if (a?.reserved)
    rows.push({
      key: "reserved",
      count: a.reserved,
      label: "pieces reserved",
      tone: "neutral",
      onClick: () => onFilter(""),
    });
  if (quiet)
    rows.push({
      key: "quiet",
      count: 0,
      label:
        last === null
          ? "no movements have ever been logged"
          : "no movement in over a week",
      tone: "warning",
      onClick: () => onFilter(""),
    });

  return (
    <section className="relative overflow-hidden rounded-2xl p-5 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_18px_40px_-28px_rgba(28,25,23,0.25)] sm:p-6">
      <SpotlightCard tone="light" className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)]">
              <ScanBarcodeIcon size={16} />
            </span>
            <div>
              <h2 className="font-sans text-[15px] font-semibold tracking-normal text-ink">
                Needs attention
              </h2>
              <p className="text-xs text-ink-4">
                {a ? `${a.movements_24h} movements in 24h` : "Loading"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex-1">
          {error ? (
            <QueryError message={error} onRetry={onRetry} />
          ) : loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl bg-gradient-to-b from-emerald-50 to-paper px-6 py-9 text-center ring-1 ring-emerald-600/10">
              <span className="relative mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-600 text-paper">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/30" />
                <CheckCircleIcon size={20} />
              </span>
              <p className="text-sm font-semibold text-ink">All clear</p>
              <p className="mt-1 text-xs text-ink-4">
                Nothing is in transit, repair or waiting on a decision.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={r.onClick}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition-colors",
                      ALERT_TONE[r.tone]
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 animate-pulse-soft rounded-full",
                        ALERT_DOT[r.tone]
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {r.count > 0 ? `${r.count} ${r.label}` : r.label}
                      </span>
                      <span className="block truncate text-xs text-ink-4">View movements</span>
                    </span>
                    <ArrowRightIcon size={13} className="mt-1 shrink-0 text-ink-5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SpotlightCard>
    </section>
  );
}

/* ---------------------------------------------------------------- Scan preview */

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "found"; piece: Piece };

export function PiecePreview({ code }: { code: string }) {
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  const trimmed = code.trim();

  useEffect(() => {
    if (!trimmed) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    const t = setTimeout(async () => {
      try {
        const data = await api<Piece>(`/api/v1/products/barcode/${encodeURIComponent(trimmed)}`);
        if (!cancelled) setState({ kind: "found", piece: data });
      } catch (e) {
        if (!cancelled)
          setState({ kind: "error", message: e instanceof Error ? e.message : "Piece not found" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trimmed]);

  if (state.kind === "idle")
    return (
      <div className="rounded-xl border border-dashed border-ink/15 bg-bone/40 px-4 py-8 text-center">
        <ScanBarcodeIcon size={20} className="mx-auto text-ink-5" />
        <p className="mt-2 text-xs text-ink-4">Scan or type a barcode to preview the piece</p>
      </div>
    );

  if (state.kind === "loading") return <Skeleton className="h-32 rounded-xl" />;

  if (state.kind === "error")
    return (
      <Callout tone="danger" title="No piece with that barcode">
        {state.message} Check the label and scan again.
      </Callout>
    );

  const p = state.piece.product;
  return (
    <div className="animate-fade-in rounded-xl bg-bone/60 p-4 ring-1 ring-ink/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{p.name}</div>
          <div className="mt-0.5 font-mono text-xs text-ink-4">{p.barcode}</div>
        </div>
        <StatusPill status={p.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        {[
          ["Purity", p.karat],
          ["Branch", p.branch_id.slice(0, 8)],
          ["Net weight", `${grams(p.net_mg)} g`],
          ["Fine gold", `${grams(p.fine_gold_mg)} g`],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-ink-4">{k}</dt>
            <dd className="mt-0.5 truncate font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------------- Filters */

export function MovementFilters({
  type,
  branch,
  search,
  onType,
  onBranch,
  onSearch,
  branches,
}: {
  type: string;
  branch: string;
  search: string;
  onType: (t: string) => void;
  onBranch: (b: string) => void;
  onSearch: (s: string) => void;
  branches: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <FilterChips
        options={MOVEMENT_TYPES}
        value={type}
        onChange={onType}
        ariaLabel="Movement type"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <SearchIcon
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-5"
          />
          <span className="sr-only">Search movements</span>
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search barcode or reason"
            className={cn(controlSmClass, "w-64 pl-9")}
          />
        </label>
        <label>
          <span className="sr-only">Filter by branch</span>
          <select
            value={branch}
            onChange={(e) => onBranch(e.target.value)}
            className={cn(controlSmClass, "w-auto")}
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Detail modal */

export function PieceDetail({
  piece,
  onClose,
  onMove,
}: {
  piece: Piece;
  onClose: () => void;
  onMove: (barcode: string) => void;
}) {
  const p = piece.product;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="g-floating w-full max-w-md animate-fade-in space-y-4 p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Piece detail"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="g-kicker">{p.karat}</div>
            <h2 className="mt-1 truncate font-display text-lg font-bold tracking-tight text-ink">
              {p.name}
            </h2>
            <div className="mt-1 font-mono text-xs text-ink-4">{p.barcode}</div>
          </div>
          <StatusPill status={p.status} />
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-ink/[0.07] py-4 text-sm">
          {[
            ["Branch", p.branch_id.slice(0, 8)],
            ["Net weight", `${grams(p.net_mg)} g`],
            ["Fine gold", `${grams(p.fine_gold_mg)} g`],
            ["Cost", rupees(p.cost_cents)],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-ink-4">{k}</dt>
              <dd className="mt-0.5 truncate font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap justify-end gap-2">
          <Link href={`/products/${p.id}`} className="g-btn g-btn-secondary h-10 px-4 text-sm">
            View product
          </Link>
          <button
            type="button"
            className="g-btn g-btn-primary h-10 px-4 text-sm"
            onClick={() => onMove(p.barcode)}
          >
            Record movement
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter goldos-web lint`

Expected: clean. If `ArchiveIcon`, `ScaleIcon`, `PackageIcon`, `GemIcon`, `Building2Icon`, `SearchIcon`, `CheckCircleIcon`, `ScanBarcodeIcon`, `ArrowRightIcon` do not all resolve, they exist in `components/icons.tsx` — re-check the import list against `grep -c "export function" apps/web/components/icons.tsx` and fix the import, not the icons file.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/inventory/panels.tsx"
git commit -m "feat: inventory hero, stock charts, attention card and scan preview panels"
```

---

### Task 8: Inventory page composition — hero, insights, stock table

**Files:**
- Modify: `apps/web/app/(app)/inventory/page.tsx` (replace wholesale)

**Interfaces:**
- Consumes: everything from `./panels` and `./columns` (Tasks 6 and 7); `api`, `MeData` from `@/lib/api`; `hasPermission` from `@goldos/shared`; `Tabs`, `TableCard`, `Pager`, `Panel`, `Callout`, `controlClass`, `EmptyBlock`, `Page`, `Skeleton` from `@/components/ui`; `useMutation`, `useQuery`, `useQueryClient` from `@tanstack/react-query`; `toast` from `sonner`.
- Produces: a page that renders `InventoryHero`, the three insight panels, and the stock `TableCard`. Task 9 adds the movement panel and history.

- [ ] **Step 1: Replace the page**

Overwrite `apps/web/app/(app)/inventory/page.tsx` with:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { Page, TableCard, Tabs, EmptyBlock } from "@/components/ui";
import { Building2Icon, GemIcon, PackageIcon } from "@/components/icons";
import { InventoryHero, StockByKarat, StockByBranch, AttentionCard } from "./panels";
import { stockColumns, type Insights, type StockRow } from "./columns";

const GROUP_LABEL: Record<"branch" | "purity" | "product", string> = {
  branch: "branch",
  purity: "purity",
  product: "product",
};

export default function InventoryPage() {
  const [groupBy, setGroupBy] = useState<"branch" | "purity" | "product">("branch");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canView = hasPermission(me.data?.permissions ?? [], "products:view");

  const insights = useQuery({
    queryKey: ["inventory", "insights"],
    queryFn: () => api<Insights>("/api/v1/inventory/insights"),
    enabled: canView,
    staleTime: 60_000,
    retry: false,
  });

  const stock = useQuery({
    queryKey: ["stock", groupBy],
    queryFn: () => api<StockRow[]>(`/api/v1/inventory/stock?groupBy=${groupBy}`),
    enabled: canView,
  });

  const columns = useMemo(() => stockColumns(groupBy), [groupBy]);

  const rows = useMemo(() => {
    const base = stock.data ?? [];
    if (!sort) return base;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return base;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [stock.data, sort, columns]);

  const totals = useMemo(() => {
    const base = stock.data ?? [];
    return {
      pieces: base.reduce((s, r) => s + r.pieces, 0),
      net: base.reduce((s, r) => s + r.net_mg, 0),
      fine: base.reduce((s, r) => s + r.fine_mg, 0),
      value: base.reduce((s, r) => s + (r.value_cents ?? 0), 0),
      hasValue: base.some((r) => r.value_cents !== null),
    };
  }, [stock.data]);

  function onSort(key: string) {
    setSort((s) =>
      s?.key === key
        ? s.dir === "asc"
          ? { key, dir: "desc" }
          : null
        : { key, dir: "desc" }
    );
  }

  return (
    <Page className="space-y-5">
      <InventoryHero
        insights={insights.data}
        loading={insights.isLoading}
        error={insights.isError ? (insights.error as Error).message : undefined}
        onRecord={() =>
          document.getElementById("record-movement")?.scrollIntoView({ behavior: "smooth" })
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <StockByKarat
          data={insights.data}
          loading={insights.isLoading}
          error={insights.isError ? (insights.error as Error).message : undefined}
          onRetry={() => void insights.refetch()}
        />
        <StockByBranch
          data={insights.data}
          loading={insights.isLoading}
          error={insights.isError ? (insights.error as Error).message : undefined}
          onRetry={() => void insights.refetch()}
        />
        <AttentionCard
          data={insights.data}
          loading={insights.isLoading}
          error={insights.isError ? (insights.error as Error).message : undefined}
          onRetry={() => void insights.refetch()}
          onFilter={(t) => setPendingType(t)}
        />
      </div>

      <TableCard
        title="Stock on hand"
        description={`Grouped by ${GROUP_LABEL[groupBy]}`}
        icon={<PackageIcon size={16} />}
        toolbar={
          <Tabs
            ariaLabel="Group stock by"
            items={[
              { key: "branch" as const, label: "By branch", icon: <Building2Icon size={15} /> },
              { key: "purity" as const, label: "By purity", icon: <GemIcon size={15} /> },
              { key: "product" as const, label: "By product", icon: <PackageIcon size={15} /> },
            ]}
            value={groupBy}
            onChange={setGroupBy}
          />
        }
      >
        {/* Body and totals row are completed in Task 9; the DataTable is wired
            here so the hero and insights row are verifiable on their own. */}
        <StockTableBody
          rows={rows}
          columns={columns}
          sort={sort}
          onSort={onSort}
          loading={stock.isLoading}
          totals={totals}
        />
      </TableCard>
    </Page>
  );
}
```

- [ ] **Step 2: Add the `StockTableBody` helper to the same file**

Append to `apps/web/app/(app)/inventory/page.tsx`. Move the imports it needs to the top of the file in the same edit:

```tsx
import { DataTable, type DataColumn } from "@/components/ui";

function StockTableBody({
  rows,
  columns,
  sort,
  onSort,
  loading,
  totals,
}: {
  rows: StockRow[];
  columns: ReadonlyArray<DataColumn<StockRow>>;
  sort: { key: string; dir: "asc" | "desc" } | null;
  onSort: (key: string) => void;
  loading: boolean;
  totals: { pieces: number; net: number; fine: number; value: number; hasValue: boolean };
}) {
  const g = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      sort={sort}
      onSort={onSort}
      loading={loading}
      caption="Stock on hand, grouped"
      empty={
        <EmptyBlock
          title="No stock on hand"
          description={`No pieces are in stock for this ${"grouping"}.`}
          action={
            <Link href="/products" className="g-btn g-btn-primary h-10 px-4 text-sm">
              Open catalog
            </Link>
          }
        />
      }
      totals={
        <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs text-ink-3">
          <span className="font-semibold uppercase tracking-[0.14em] text-ink-4">Total</span>
          <span className="num-tabular">
            {totals.pieces.toLocaleString("en-US")} pieces
          </span>
          <span className="num-tabular">{g(totals.net)} g net</span>
          <span className="num-tabular">{g(totals.fine)} g fine</span>
          <span className="num-tabular">
            {totals.hasValue
              ? `LKR ${centsToLkr(totals.value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
              : "—"}
          </span>
        </div>
      }
    />
  );
}
```

Add `mgToG` and `centsToLkr` to the existing `@goldos/shared` import so the line reads:

```tsx
import { centsToLkr, hasPermission, mgToG } from "@goldos/shared";
```

- [ ] **Step 3: Add the pending-filter state so the attention card compiles**

The attention card's `onFilter` needs somewhere to go before Task 9 builds the movement table. Add state and wire it:

```tsx
  const [pendingType, setPendingType] = useState("");
```

```tsx
          onFilter={(t) => setPendingType(t)}
```

Task 9 replaces this with the live `mType` filter plus a scroll to the history card. Do not build any UI around `pendingType` in this task.

- [ ] **Step 4: Typecheck the web app**

Run: `pnpm --filter goldos-web lint`

Expected: clean. If `noUnusedLocals` flags `pendingType` as written-but-unread, silence it for this one task by reading it in the stock card's description, which is a real label change the user benefits from anyway:

```tsx
        description={
          pendingType
            ? `Grouped by ${GROUP_LABEL[groupBy]} · alert filter: ${pendingType || "none"}`
            : `Grouped by ${GROUP_LABEL[groupBy]}`
        }
```

Task 9 removes this from the stock card and puts the filter where it belongs, on the movement card.

- [ ] **Step 5: Verify the page builds and renders**

Run: `pnpm --filter goldos-web build`

Expected: build succeeds. Then `pnpm dev` from the repo root, open `/inventory`, and confirm: the dark hero shows four stat cells, the karat and branch charts render bars, the attention card shows either rows or the green "All clear" block, and the stock table shows a totals footer that updates when you switch the grouping tabs.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/inventory/page.tsx"
git commit -m "feat: premium inventory hero, insight panels and stock table"
```

---

### Task 9: Movement panel, scan prefill, and paged history

**Files:**
- Modify: `apps/web/app/(app)/inventory/page.tsx`

**Interfaces:**
- Consumes: `PiecePreview`, `MovementFilters`, `PieceDetail` from `./panels`; `movementColumns`, `Movement`, `Piece` from `./columns`; `Panel`, `Callout`, `Field`, `Pager`, `ButtonPrimary`, `ButtonSecondary`, `controlClass` from `@/components/ui`; `useMutation`, `useQueryClient` from `@tanstack/react-query`; `toast` from `sonner`.
- Produces: the final page. Mutation contract unchanged — `POST /inventory/movements` with `{ productId, toStatus, toBranchId?, reason? }`.

- [ ] **Step 1: Add the movement and history state**

In `apps/web/app/(app)/inventory/page.tsx`, add to the state block:

```tsx
  const [barcode, setBarcode] = useState("");
  const [toStatus, setToStatus] = useState("RETURNED");
  const [toBranch, setToBranch] = useState("");
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<Piece | null>(null);
  const [mType, setMType] = useState("");
  const [mBranch, setMBranch] = useState("");
  const [mSearch, setMSearch] = useState("");
  const [mPage, setMPage] = useState(1);
  const barcodeRef = useRef<HTMLInputElement>(null);
```

Add `useRef` to the React import, add `useMutation, useQueryClient` to the react-query import, add `toast` from `sonner`, and add `Piece`, `Movement`, `movementColumns` to the `./columns` import.

- [ ] **Step 2: Add the branches, movements and detail queries**

Add after the `stock` query:

```tsx
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Array<{ id: string; name: string }>; total: number }>("/api/v1/branches?limit=100"),
    staleTime: 60_000,
  });

  const moves = useQuery({
    queryKey: ["moves", mPage, mType, mBranch, mSearch],
    queryFn: () => {
      const q = new URLSearchParams({ limit: "25", page: String(mPage) });
      if (mType) q.set("type", mType);
      if (mBranch) q.set("branchId", mBranch);
      if (mSearch.trim()) q.set("search", mSearch.trim());
      return api<{ rows: Movement[]; total: number }>(`/api/v1/inventory/movements?${q}`);
    },
    enabled: canView,
  });
```

Add a debounced search so a keystroke does not fire a request per character. Insert before the component and use it for `moves`:

```tsx
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
```

Add `useEffect` to the React import and change the movements query to:

```tsx
  const mSearchDebounced = useDebounced(mSearch);
  const moves = useQuery({
    queryKey: ["moves", mPage, mType, mBranch, mSearchDebounced],
    queryFn: () => {
      const q = new URLSearchParams({ limit: "25", page: String(mPage) });
      if (mType) q.set("type", mType);
      if (mBranch) q.set("branchId", mBranch);
      if (mSearchDebounced.trim()) q.set("search", mSearchDebounced.trim());
      return api<{ rows: Movement[]; total: number }>(`/api/v1/inventory/movements?${q}`);
    },
    enabled: canView,
  });
```

- [ ] **Step 3: Add the mutation, replacing `pendingType` with `mType`**

Add the mutation, keeping the existing request body and toast behaviour:

```tsx
  const qc = useQueryClient();
  const move = useMutation({
    mutationFn: async () => {
      const found = await api<Piece>(`/api/v1/products/barcode/${encodeURIComponent(barcode.trim())}`);
      return api("/api/v1/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          productId: found.product.id,
          toStatus,
          toBranchId: toBranch || undefined,
          reason: reason || undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Movement recorded");
      setBarcode("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["moves"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["inventory", "insights"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Movement failed"),
  });

  const needsBranch = toStatus === "TRANSFER_PENDING";
  const moveInvalid = !barcode.trim() || (needsBranch && !toBranch.trim());
```

Delete the `pendingType` state and its `setPendingType` reference, and point the attention card at the live filter instead:

```tsx
        <AttentionCard
          data={insights.data}
          loading={insights.isLoading}
          onFilter={(t) => {
            setMType(t);
            setMPage(1);
            document.getElementById("movement-history")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
```

- [ ] **Step 4: Wire the stock table's row click to the detail modal**

Change the `DataTable` call inside `StockTableBody` to accept and pass `onRowClick`:

```tsx
      onRowClick={onRowClick}
```

Add the prop to `StockTableBody`'s signature:

```tsx
  onRowClick: (r: StockRow) => void;
```

Then in the page, fetch the full piece for the clicked key. The stock row key is a branch id, purity id, or product id depending on the grouping — only the `product` grouping yields a fetchable id:

```tsx
  async function openPiece(key: string) {
    if (groupBy !== "product") return;
    try {
      const piece = await api<Piece>(`/api/v1/products/${encodeURIComponent(key)}`);
      setDetail(piece);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the piece");
    }
  }
```

Pass `onRowClick={openPiece}` to `<StockTableBody>`. Row clicks are only enabled for the product grouping; in the other two groupings the cursor must not imply an action, so pass `undefined`:

```tsx
        <StockTableBody
          rows={rows}
          columns={columns}
          sort={sort}
          onSort={onSort}
          loading={stock.isLoading}
          totals={totals}
          onRowClick={groupBy === "product" ? openPiece : undefined}
        />
```

- [ ] **Step 5: Add the Record movement panel**

Insert between the stock `TableCard` and the closing `</Page>`:

```tsx
      <div id="record-movement">
        <Panel
          title="Record movement"
          description="Scan a barcode and post a status change."
          icon={<RefreshCwIcon size={16} />}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <Field
                label="Barcode"
                htmlFor="mv-barcode"
                hint="Press Enter to post. Scans are picked up automatically."
              >
                <input
                  id="mv-barcode"
                  ref={barcodeRef}
                  autoFocus
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !moveInvalid) move.mutate();
                  }}
                  placeholder="JW-XXXXXX"
                  className={cn(controlClass, "font-mono")}
                  aria-describedby="mv-barcode-hint"
                />
              </Field>
              <PiecePreview code={barcode} />
            </div>

            <div className="min-w-0 space-y-3">
              <Field label="To status" htmlFor="mv-status">
                <select
                  id="mv-status"
                  value={toStatus}
                  onChange={(e) => setToStatus(e.target.value)}
                  className={controlClass}
                >
                  {["IN_STOCK", "RETURNED", "TRANSFER_PENDING"].map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="To branch"
                htmlFor="mv-branch"
                hint={needsBranch ? "Required for a transfer." : "Only used for transfers."}
                error={needsBranch && !toBranch.trim() ? "Pick a branch to transfer to" : undefined}
              >
                <select
                  id="mv-branch"
                  value={toBranch}
                  onChange={(e) => setToBranch(e.target.value)}
                  className={controlClass}
                  aria-invalid={needsBranch && !toBranch.trim()}
                  aria-describedby="mv-branch-hint"
                >
                  <option value="">No change</option>
                  {(branches.data?.rows ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Reason" htmlFor="mv-reason" hint="Optional, kept on the movement record.">
                <input
                  id="mv-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Customer return, workshop move…"
                  className={controlClass}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <ButtonPrimary
                  type="button"
                  onClick={() => move.mutate()}
                  disabled={move.isPending || moveInvalid}
                >
                  {move.isPending ? "Recording…" : "Record movement"}
                </ButtonPrimary>
                <ButtonSecondary
                  type="button"
                  onClick={() => {
                    setBarcode("");
                    setToBranch("");
                    setReason("");
                  }}
                >
                  Clear
                </ButtonSecondary>
              </div>
            </div>
          </div>

          <Callout tone="info" className="mt-5">
            Sales go through the POS, shortages through counts, and voids through the product page.
            This panel handles restocks and same-branch moves.
          </Callout>
        </Panel>
      </div>
```

Add the imports this needs: `RefreshCwIcon` from `@/components/icons`, `cn` from `@/lib/cn`, and `Callout`, `Field`, `Panel`, `ButtonPrimary`, `ButtonSecondary` from `@/components/ui`.

- [ ] **Step 6: Add the movement history card and pager**

Insert after the movement panel:

```tsx
      <div id="movement-history">
        <TableCard
          title="Movement history"
          description={
            mType ? `Filtered to ${mType.replace(/_/g, " ")}` : "Latest movements"
          }
          toolbar={
            <MovementFilters
              type={mType}
              branch={mBranch}
              search={mSearch}
              onType={(t) => {
                setMType(t);
                setMPage(1);
              }}
              onBranch={(b) => {
                setMBranch(b);
                setMPage(1);
              }}
              onSearch={setMSearch}
              branches={branches.data?.rows ?? []}
            />
          }
          footer={
            moves.data ? (
              <Pager
                page={mPage}
                onChange={setMPage}
                pageSize={25}
                count={moves.data.rows.length}
                total={moves.data.total}
                unit="movements"
              />
            ) : null
          }
        >
          <DataTable
            columns={movementColumns((id) =>
              branches.data?.rows.find((b) => b.id === id)?.name ?? (id ? id.slice(0, 8) : "—")
            )}
            rows={moves.data?.rows ?? []}
            rowKey={(m) => m.id}
            loading={moves.isLoading}
            caption="Inventory movement history"
            empty={
              <EmptyBlock
                title="No movements"
                description="Nothing matches these filters. Clear them to see the ledger."
              />
            }
          />
        </TableCard>
      </div>
```

Add `DataTable` and `Pager` to the `@/components/ui` import.

- [ ] **Step 7: Render the detail modal**

Immediately before the closing `</Page>`:

```tsx
      {detail ? (
        <PieceDetail
          piece={detail}
          onClose={() => setDetail(null)}
          onMove={(code) => {
            setDetail(null);
            setBarcode(code);
            document.getElementById("record-movement")?.scrollIntoView({ behavior: "smooth" });
            window.setTimeout(() => barcodeRef.current?.focus(), 300);
          }}
        />
      ) : null}
```

- [ ] **Step 8: Typecheck and build the web app**

Run: `pnpm --filter goldos-web lint && pnpm --filter goldos-web build`

Expected: both clean. `DataColumn`, `Movement`, `Piece`, `movementColumns`, `Pager`, `DataTable`, `Field`, `Panel`, `Callout`, `ButtonPrimary`, `ButtonSecondary`, `MovementFilters`, `PiecePreview`, `PieceDetail` must all resolve.

- [ ] **Step 9: Manual verification pass**

Run: `pnpm dev`, open `/inventory`, and confirm each of these:

1. Hero shows pieces, net g, fine g, and stock value; switching the grouping tabs does not change the hero totals.
2. With no gold rates published, the hero shows "No priced stock", the gauge is neutral, and the page still renders.
2b. With the API stopped before load, the hero shows "—" in every stat (never `0`), the kicker reads "Data unavailable", and each insight panel shows its own Retry. Retry succeeds once the API is back. The stock table and movement history keep working if only `insights` fails.
3. Karat and branch charts show one bar per row with values on the right.
4. Attention card shows amber/gold rows when there are in-transit or in-repair pieces, green "All clear" otherwise; clicking a row filters the movement table and scrolls to it.
5. Stock table headers sort on click in the order desc → asc → unsorted, and the totals footer updates with the grouping.
6. Clicking a product-grouped row opens the detail modal; "Record movement" closes it, scrolls to the panel, and fills the barcode.
7. Typing a valid barcode shows the preview within ~400 ms; typing a wrong one shows the red callout without submitting.
8. Enter in the barcode field posts the movement; the toast appears, the barcode clears, and the hero, charts, stock table and history all refresh.
9. Choosing `TRANSFER_PENDING` without a branch shows the inline error and keeps the button disabled.
10. Posting an impossible transition shows the server's message in the toast.
11. Movement filters, search, and the pager all change the result set, and the pager's "Showing x–y of n" is correct.
12. The layout holds at 375px wide with no horizontal overflow.

- [ ] **Step 10: Run the full verification suite**

Run: `pnpm --filter goldos-api test && pnpm --filter goldos-api lint && pnpm --filter goldos-web lint && pnpm --filter goldos-web build`

Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add "apps/web/app/(app)/inventory/page.tsx"
git commit -m "feat: inventory movement panel with scan preview and paged history"
```

---

## Plan Self-Review

**Spec coverage**

| Spec section | Tasks |
|---|---|
| 4.1 Dark hero | 7 (`InventoryHero`), 8 |
| 4.2 Insight row (karat, branch, attention) | 7, 8 |
| 4.3 Stock table, tabs, totals, fine-share bar, row modal | 6, 8, 9 |
| 4.4 Movement panel, scan preview, callout | 7 (`PiecePreview`), 9 |
| 4.5 History: pager, chips, branch select, search, `StatusPill` | 6 (`movementColumns`), 7 (`MovementFilters`), 9 |
| 5 `MetricCard`, `BarList`, `GaugeRing` | 4 |
| 5 `DataTable`, `FilterChips`, `Field` | 5 |
| 5 `useCountUp` extraction | 3 |
| 5 page split (`page.tsx` / `panels.tsx` / `columns.tsx`) | 6, 7, 8, 9 |
| 6 `GET /inventory/insights` + `inventoryInsights` | 1, 2 |
| 7 Data flow and query keys | 8, 9 |
| 8 Error and empty handling | 7 (`QueryError` + per-panel states, hero dash-on-error), 8, 9 |
| 9 Accessibility | 5 (`aria-sort`, `sr-only`, `aria-invalid`), 6 (`sr-only` caption), 7 (`aria-hidden` gauge, `role="alert"`) |
| 10 Performance (`staleTime`, CSS transitions, row caps) | 7 (10-branch cap), 8, 9 (`staleTime`, debounce) |
| 11 Testing | 1 |

**Deliberate omissions from the spec, with reasons**

- The dashboard's `TodayGauge` is not replaced by `GaugeRing` — the spec's §5 states the dashboard keeps its own copy in this slice. Adopting it there would be an edit to a page outside this spec's scope.
- No dashboard refactor onto the new primitives, per spec §5.

**Type consistency check**

`priceStock(netMg, rateCentsPerG?) → number` (Task 1) is consumed by no other task; the route (Task 2) returns `InventoryInsights` unchanged. `InventoryInsights` (Task 1) matches `Insights` (Task 6) field-for-field — both are wire types, and `page.tsx` types the `api<Promise>` call as `Insights`, so a drift would surface as a `tsc` error at the point of use. `stockColumns`/`movementColumns` are consumed by `page.tsx` in Tasks 8 and 9. `MovementTypeIcon` and `movementTypeMeta` are defined in Task 6 and consumed in the same file. `piece.product` fields used in `PiecePreview` and `PieceDetail` are all declared in `Piece` (Task 6).

**Known implementation notes for the executor**

- Task 8's `pendingType` is an intentional placeholder for the movement-type filter that does not exist until Task 9. If the build fails on an unused variable, Task 8 Step 4 gives the fallback. Do not carry it past Task 9.
- Task 6's four new icons (`PackagePlusIcon`, `ArrowUturnLeftIcon`, `CircleSlashIcon`, `ArrowLeftRightIcon`) must use the file's `base(props)` spread helper. An inline-attribute `<svg>` will look different from the other 46 icons and is a review failure.
- `useDebounced` is declared in Task 9 Step 2 before the component. If the executor prefers, it may live at the top of the same file; it must not go into `lib/`, since it has exactly one consumer.
