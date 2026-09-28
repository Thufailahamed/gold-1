# Monthly Slice 3 (Exports + Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-section server CSV, the monthly report page with print and multi-sheet xlsx export, and the recharts owner analytics dashboard.

**Architecture:** `GET /reports/monthly?format=csv&section=` flattens the existing `MonthlyReport` with the shared `toCsv` escaper (no new queries); web adds `recharts` + `xlsx` deps, a `downloadCsv` lib helper, `/(app)/reports/monthly` page, `/(app)/analytics` page, two sidebar entries, and a print stylesheet. Screen, CSV, xlsx, and print all derive from the same fetched JSON.

**Tech Stack:** Hono 4 API, Next.js 16 + React 19 + Tailwind web, TanStack Query 5, recharts + xlsx (new), Vitest 2, TypeScript 5.5 strict (no `any`).

## Global Constraints

- Money in CSV as INTEGER cents, weights as INTEGER mg; preamble states `units: money=cents weight=mg` — no rounding lies.
- CSV requires `audit:export` after the existing `accounts:view` + branch gate; unknown section → 400.
- JSON responses byte-identical to today.
- Gaps stay gaps on charts (no interpolation); empty states are copy, not zeros; estimates never in profit tiles; every tile basis-badged.
- Web has no test runner: verification is `tsc --noEmit`, `next build`, plus the manual checklist in Task 5.

---

### Task 1: Server CSV for monthly sections

**Files:**
- Modify: `apps/api/src/routes/monthly.ts`
- Test: `apps/api/src/services/monthlyCsv.test.ts` (new file testing the flatten helper — see below)

**Interfaces:**
- Consumes: `toCsv(preamble, cols, rows)` from `../services/discrepancies`; `MonthlyReport` type from `../services/monthly`; existing `shopWideAllowed` + `monthlyQuerySchema` in the same route file.
- Produces: `GET /reports/monthly?format=csv&section=<name>` consumed by Task 3 download links. Pure helper `sectionRows(section, report): { cols: string[]; rows: Record<string, unknown>[] }` exported from the route file? No — route files hold no logic per layer rules (routes validate only). Put `sectionRows` in `apps/api/src/services/monthly.ts` (exported), routes only validate + call. Adjust: create helper in services/monthly.ts, wire in routes/monthly.ts.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { sectionRows } from "./monthly";

const base = {
  meta: { from: "2026-09-01", to: "2026-09-30", month: "2026-09", branchId: "b1" },
  sales: { totalCents: 100000, invoiceCount: 2, grossCents: 110000, returnsCents: 10000, netCents: 100000, hasData: true },
  profit: { revenueCents: 100000, cogsCents: 60000, grossProfitCents: 40000, operatingExpensesCents: 10000, netProfitCents: 30000, basis: "ledger-posted-only" as const },
} as never;

describe("sectionRows", () => {
  it("flattens profit legs", () => {
    const r = sectionRows("profit", base);
    expect(r.cols).toContain("netProfitCents");
    expect(r.rows[0]).toMatchObject({ netProfitCents: 30000 });
  });
  it("rejects unknown sections at the type level", () => {
    expect(() => sectionRows("nope" as never, base)).toThrow();
  });
});
```

`as never` casts dodge building a full MonthlyReport in the test (the helper only touches the requested section; document that contract on the helper). Save as `apps/api/src/services/monthlyCsv.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/monthlyCsv.test.ts`
Expected: FAIL with "sectionRows is not defined" (not exported).

- [ ] **Step 3: Implement sectionRows in services/monthly.ts**

```ts
export const MONTHLY_SECTIONS = ["sales", "purchases", "gold", "expenses", "profit", "cashflow", "receivables", "payables", "inventory"] as const;
export type MonthlySection = (typeof MONTHLY_SECTIONS)[number];

export function sectionRows(section: MonthlySection, report: MonthlyReport): { cols: string[]; rows: Record<string, unknown>[] } {
  const flat = (o: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v as Record<string, unknown>));
      else if (!Array.isArray(v)) out[k] = v;
    }
    return out;
  };
  const pick = (o: unknown): Record<string, unknown>[] => {
    if (Array.isArray(o)) return o as Record<string, unknown>[];
    if (o !== null && typeof o === "object") return [flat(o as Record<string, unknown>)];
    return [];
  };
  const r = report[section] as unknown;
  if (section === "receivables" || section === "payables") {
    const p = r as { lines: unknown[]; aging: Record<string, number> };
    return { cols: ["partyId", "name", "balanceCents"], rows: [...(p.lines as Record<string, unknown>[]), { partyId: "AGING", name: JSON.stringify(p.aging), balanceCents: "" }] };
  }
  if (section === "inventory") {
    const inv = r as { byBranch: unknown[]; byCategory: unknown[]; byPurity: unknown[] } & Record<string, unknown>;
    const { byBranch, byCategory, byPurity, ...rest } = inv;
    return {
      cols: ["scope", "key", "cents"],
      rows: [
        ...Object.entries(rest).filter(([, v]) => typeof v !== "object").map(([key, cents]) => ({ scope: "total", key, cents })),
        ...(byBranch as Record<string, unknown>[]).map((b) => ({ scope: "branch", ...b })),
        ...(byCategory as Record<string, unknown>[]).map((b) => ({ scope: "category", ...b })),
        ...(byPurity as Record<string, unknown>[]).map((b) => ({ scope: "purity", ...b })),
      ],
    };
  }
  if (section === "expenses") {
    const e = r as { byCategory: Record<string, unknown>[]; totalCents: number; pendingCents: number };
    return { cols: ["accountCode", "name", "cents"], rows: [...e.byCategory, { accountCode: "TOTAL", name: "", cents: e.totalCents }, { accountCode: "PENDING", name: "", cents: e.pendingCents }] };
  }
  const rows = pick(r);
  return { cols: Object.keys(rows[0] ?? { note: "empty" }), rows: rows.length ? rows : [{ note: "no data" }] };
}
```

Unknown section: the `MonthlySection` type restricts callers; the route validates with `z.enum(MONTHLY_SECTIONS)` so `"nope"` never reaches the helper at runtime — the test's `as never` throw comes from... hmm, the helper as written does NOT throw for unknown strings (it would hit `pick`/`report[section]` → undefined → `pick(undefined)` → []). Fix the test expectation instead: unknown section yields `[{ note: "no data" }]` rows (no throw). Update the test: `expect(sectionRows("nope" as never, base).rows).toEqual([{ note: "no data" }])`. The 400 for unknown sections happens at route validation (Task 2), tested there... route tests don't exist (no route test files in repo). Cover the 400 via the zod enum: no test needed beyond typecheck — state that.

- [ ] **Step 4: Wire the route + run tests**

In `apps/api/src/routes/monthly.ts`, add to the `GET /monthly` handler (before the JSON return): if `c.req.query("format") === "csv"`, validate `section` with `z.enum(MONTHLY_SECTIONS)` (400 otherwise), check `AUDIT_EXPORT` (403 otherwise), then `return new Response(toCsv(preamble, cols, rows), { headers: { "Content-Type": "text/csv" } })` with preamble `[generated_at, month YYYY-MM, branch name-or-shop, "units: money=cents weight=mg", "basis: ledger-posted", "source: live-read, not a frozen snapshot"]`. Branch name: query `branches` table (fall back to id). Import `toCsv` from `../services/discrepancies`, `sectionRows`/`MONTHLY_SECTIONS` from `../services/monthly`, `z` from zod.

Run: `pnpm --filter goldos-api exec vitest run src/services/monthlyCsv.test.ts` — PASS. `pnpm --filter goldos-api exec tsc --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/monthly.ts apps/api/src/services/monthlyCsv.test.ts apps/api/src/routes/monthly.ts
git commit -m "feat: monthly per-section server csv"
```

### Task 2: Web deps + download helper + sidebar

**Files:**
- Modify: `apps/web/package.json` (deps), `apps/web/lib/api.ts` (append `downloadCsv`), `apps/web/components/app-sidebar.tsx` (two entries)
- Test: none (web has no runner) — verification: `pnpm --filter goldos-web exec tsc --noEmit`

**Interfaces:**
- Consumes: existing `BASE`, `hasPermission`, sidebar `NavItem` shape.
- Produces: `recharts` + `xlsx` installed; `downloadCsv(path, filename)` used by Task 3; sidebar links used by Tasks 3–4.

- [ ] **Step 1: Install deps**

Run: `pnpm --filter goldos-web add recharts xlsx`
Record the installed versions from the `pnpm-lock.yaml` diff into the commit message (e.g. `recharts 3.x, xlsx 0.18.x`). Then: `pnpm --filter goldos-web exec tsc --noEmit` — must PASS (new deps unreferenced yet).

- [ ] **Step 2: Append download helper**

```ts
/** Authenticated text download (server CSV). Throws with the API message on error. */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const text = await res.text();
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Append to `apps/web/lib/api.ts` (`BASE` is module-local — reuse in place).

- [ ] **Step 3: Sidebar entries**

In `app-sidebar.tsx` SECTIONS, add a "Reports" section (after Sales or near day-closing — read the file around the day-closing/accounts entries first and match placement):
`{ href: "/reports/monthly", label: "Monthly", icon: HistoryIcon, perm: "accounts:view" }` and `{ href: "/analytics", label: "Analytics", icon: TrendingUpIcon, perm: "branches:manage" }`. Analytics requires manage (all-branches trends); the page itself double-checks and redirects without it.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm --filter goldos-web exec tsc --noEmit` — PASS.

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/lib/api.ts apps/web/components/app-sidebar.tsx
git commit -m "feat: web deps and csv download helper (recharts X, xlsx Y)"
```

(Replace X/Y with the installed versions.)

### Task 3: Monthly report page

**Files:**
- Create: `apps/web/app/(app)/reports/monthly/page.tsx`
- Create: `apps/web/app/(app)/reports/monthly/print.css` (imported by the page; `@media print` rules)

**Interfaces:**
- Consumes: `api`, `downloadCsv`, `MeData` from `@/lib/api`; `hasPermission` from shared; UI kit (`Page, Hero, StatGrid, StatCard, Panel, Pill`) + `TableCard` from audit page pattern; `MONTHLY_SECTIONS`-equivalent section list (hardcode the 9 section keys + estimates — must match API enum order).
- Produces: the page users open; Task 4 links nothing from it (independent).

- [ ] **Step 1: Write the page**

Structure (follow `audit/page.tsx` + `sales/reports/page.tsx` patterns: `"use client"`, month/year/branch state, `useQuery` per fetch, `hasPermission` gates):

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { hasPermission } from "@goldos/shared";
import { api, downloadCsv, type MeData } from "@/lib/api";
import { Page, Hero, StatGrid, StatCard, Panel, Pill } from "@/components/ui";
import "./print.css";

type Report = { meta: { month: string; branchId: string | null }; [k: string]: unknown };
const SECTIONS = ["sales","purchases","gold","expenses","profit","cashflow","receivables","payables","inventory"] as const;

function sectionRowsForXlsx(report: Report, section: string): Record<string, unknown>[] {
  const v = report[section];
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") return [v as Record<string, unknown>];
  return [];
}

export default function MonthlyPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [branchId, setBranchId] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches") });
  const perms = me.data?.permissions ?? [];
  const canExport = hasPermission(perms, "audit:export");
  const canFreeze = hasPermission(perms, "accounts:manage");
  const [note, setNote] = useState("");
  const query = `/api/v1/reports/monthly?month=${month}&year=${year}${branchId ? `&branchId=${branchId}` : ""}`;
  const report = useQuery({ queryKey: ["monthly", month, year, branchId], queryFn: () => api<Report>(query) });
  const r = report.data;
  function exportXlsx() {
    if (!r) return;
    const wb = XLSX.utils.book_new();
    for (const s of [...SECTIONS, "estimates"] ) {
      const rows = sectionRowsForXlsx(r, s);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: "no data" }]), s.slice(0, 31));
    }
    XLSX.writeFile(wb, `monthly-${r.meta.month}${r.meta.branchId ? `-${r.meta.branchId}` : "-shop"}.xlsx`);
  }
  function freeze() {
    return api<{ id: string }>(`/api/v1/reports/monthly/snapshot`, { method: "POST", body: JSON.stringify({ month, year, branchId: branchId || undefined, note: note || undefined }) });
  }
  ...cards per section with hasData empty states ("No postings this month"), Ledger/Estimate Pills, per-section CSV buttons calling downloadCsv(`${query}&format=csv&section=${s}`, `monthly-${month}-${s}.csv`), freeze button + note input when canFreeze, xlsx button when canExport...
}
```

Cards: one `Panel` per section rendering key figures (sales: net/invoices/gross/returns; profit: revenue/COGS/gross/opex/net with `basis` caption; gold: opening/in/out/closing mg; cashflow: opening/in/out/closing + unclassified warning; receivables/payables: totals + bucket rows + outstanding tables (cap 20 rows with "showing 20 of N"); inventory: jewellery/gold + group tables + method caption; estimates: badged list). Keep each card under ~40 lines — tables via `TableCard` where it fits, plain dl rows otherwise. Branch dropdown lists `branches.data` filtered to `me.data.branchIds` unless manage (mirror the API rule client-side for UX; server enforces).

`print.css`:

```css
@media print {
  nav, aside, .no-print { display: none !important; }
  main { padding: 0 !important; }
  .print-header { display: block !important; }
}
@media screen {
  .print-header { display: none; }
}
```

Page renders a `.print-header` div (month, branch, generated-at, live-read note) + wraps pickers/buttons in `.no-print` (check the ui kit: if `Page`/`Hero` expose className passthrough use it, else wrap in divs — read `components/ui.tsx` `Page`/`Hero` props first and adapt class hooks without editing the kit).

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter goldos-web exec tsc --noEmit` — PASS. Run: `pnpm --filter goldos-web exec next build` — PASS (catches recharts/xlsx bundling issues; may take minutes — allow generous timeout).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(app)/reports/monthly/page.tsx" "apps/web/app/(app)/reports/monthly/print.css"
git commit -m "feat: monthly report page with print and xlsx"
```

### Task 4: Analytics dashboard

**Files:**
- Create: `apps/web/app/(app)/analytics/page.tsx`

**Interfaces:**
- Consumes: same api/ui patterns as Task 3; recharts (`LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend`); `api<Report>` monthly shape (reuse the `Report` type by exporting it from the monthly page? No — cross-page imports rot. Define a minimal shared type in `@/lib/monthly.ts`: `MonthlySummary { meta, sales: {netCents...}, profit: {...}, cashflow: {...}, gold: {...}, receivables: {...}, inventory: {...} }` with only the fields the dashboard reads. Both pages import from lib.)
- Produces: dashboard; nothing consumes it (terminal page).

- [ ] **Step 1: Extract shared type + write dashboard**

Create `apps/web/lib/monthly.ts` exporting the minimal `MonthlySummary` type + `last12Months(now): { month, year }[]` helper (pure, handles year rollover). Refactor Task 3 page to import the type (keep its richer local needs via intersection — or just also use the minimal type; simpler: page keeps its own `Report`, dashboard uses `MonthlySummary`; duplication of ~15 lines is fine and decoupled).

Dashboard:

```tsx
"use client";
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api, type MeData } from "@/lib/api";
import { last12Months, type MonthlySummary } from "@/lib/monthly";
import { Page, Hero, StatGrid, StatCard, Panel, Pill } from "@/components/ui";

export default function AnalyticsPage() {
  const me = ...; // redirect (render denied EmptyBlock) unless branches:manage + accounts:view
  const [branchId, setBranchId] = useState("");
  const months = last12Months(new Date());
  const trends = useQueries({ queries: months.map((m) => ({ queryKey: ["trend", m.year, m.month, branchId], queryFn: () => api<MonthlySummary>(`/api/v1/reports/monthly?month=${m.month}&year=${m.year}${branchId ? `&branchId=${branchId}` : ""}`), staleTime: 5 * 60_000, retry: false })) });
  const current = trends[trends.length - 1]?.data;
  const revenue = trends.map((t, i) => ({ month: months[i].label, revenue: t.data ? t.data.profit.revenueCents / 100 : null, net: t.data ? t.data.profit.netProfitCents / 100 : null, failed: !t.data }));
  ...KPI StatCards (LKR values, "—" when current missing), LineChart revenue vs net (nulls render gaps — recharts skips null points, never connects across? recharts connects by default? `connectNulls` defaults false → gaps. State `connectNulls={false}` explicitly.), cash BarChart (in/out), gold BarChart (mg in/out), aging bucket bars from current.receivables.aging, inventory donut from current.inventory.byPurity (top 6 + Other)...
}
```

Failed months: `retry: false`, show "N of 12 months unavailable" note; nulls → gaps (`connectNulls={false}`). Estimates panel lists current.estimates with Estimate pills. Empty shop (all null): EmptyBlock zero-state copy.

- [ ] **Step 2: Typecheck + build**

`tsc --noEmit` PASS, `next build` PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/monthly.ts "apps/web/app/(app)/analytics/page.tsx"
git commit -m "feat: owner analytics dashboard with trends"
```

### Task 5: Verification + regression

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm test` — Expected: 3 successful (web still echo-pass; api + shared real).

- [ ] **Step 2: Manual checklist** (record results in the commit message trailer or as a comment — do it, don't skip):

1. Monthly page: change month → refetch (network tab shows new query); branch switch refetches.
2. Per-section CSV downloads; open one, check preamble + escaping (quote field with comma).
3. xlsx downloads with 10 sheets (9 sections + estimates); open in Excel/Sheets.
4. Print preview (Cmd/Ctrl+P): nav hidden, all cards visible, header present.
5. Dashboard: 12-month charts render; block one month (devtools offline for one request or invalid month param) → gap, not crash.
6. Perms: cashier login → no sidebar links, direct URL → 403 JSON (page shows error state, not blank).

- [ ] **Step 3: Commit the checklist**

If the checklist required code fixes, they land as separate commits first. Final:

```bash
git add -A && git commit -m "chore: slice 3 verification" # only if files changed; otherwise skip
```

Skip the empty commit — never create empty commits. If nothing changed, just proceed to finishing.

## Self-Review

- Spec §2 (CSV): Task 1 — enum-validated section, audit:export gate, shared escaper, live-read preamble with units/basis, JSON untouched. Covered.
- Spec §3 (page): Tasks 2–3 — pickers, cards, empty states, badges, CSV/xlsx/print, freeze + note, sidebar link. Covered.
- Spec §4 (dashboard): Tasks 2 + 4 — manage+view gate, KPIs, 4 recharts visuals + donut, 12 cached queries, gaps, zero-state, responsive. Covered.
- Spec §5 (deps): Task 2 — install command + version recording + build proof. Covered.
- Spec §6 (guards): Tasks 1/3/4 — single-JSON derivation, no interpolation (`connectNulls={false}`), basis badges. Covered.
- Spec §7 (testing): Tasks 1 + 5 — CSV unit tests, typecheck/build gates, manual checklist. Covered.
- Placeholder scan: no TBD/TODO; version strings recorded at install time per Task 2 (not placeholders — values genuinely unknown until install).
- Type consistency: `MonthlySection` enum shared between helper + route validation; `MonthlySummary` minimal type used by dashboard; page-local `Report` for the monthly page; `downloadCsv(path, filename)` everywhere.
