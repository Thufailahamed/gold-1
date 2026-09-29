# Accounts Dashboard Hub Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/accounts` the single obvious hub for daily expenses and monthly accounts, with Today-first hierarchy and all existing functionality verified working.

**Architecture:** Frontend-only polish on existing hub page plus two correctness fixes in sub-pages; no new routes, no API/schema changes, reuse existing ledger endpoints.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 5.5 / TanStack Query 5 / Recharts 3 / Tailwind 3 / Hono+D1 API (untouched)

## Global Constraints

- Sidebar `apps/web/components/app-sidebar.tsx` MUST NOT change — only `Accounts Dashboard` under Accounts.
- No new routes; sub-pages stay at `/expenses`, `/day-closing`, `/reports/monthly`, `/accounts/chart`.
- No backend schema or API contract changes.
- Follow existing UI primitives in `apps/web/components/ui.tsx` (`Page`, `Hero`, `Panel`, `KpiCard` pattern, `controlClass`).
- LKR money is integer cents; display via existing `lkr()` helpers (cents/100).
- Permission gates via `hasPermission` from `@goldos/shared` — `accounts:view` to see, `accounts:manage` to record/adjust/close.
- pnpm workspace (`pnpm@9.0.0`), Turbo monorepo.

---

## File Structure

- Modify: `apps/web/app/(app)/accounts/chart/page.tsx` — fix adjustment POST to include required `branchId`; owner of journal-adjustment form.
- Modify: `apps/web/app/(app)/expenses/page.tsx` — replace branch free-text with branch `<select>`; add `branchId` to list + summary queries; owner of expense register UI.
- Modify: `apps/web/app/(app)/accounts/page.tsx` — Today-first hierarchy polish, hub tiles verification, month P&L+cash summary polish; owner of dashboard hub UI.
- Verify only (no edit): `apps/web/components/app-sidebar.tsx`, `apps/web/app/(app)/day-closing/page.tsx`, `apps/web/app/(app)/reports/monthly/page.tsx`.

Each file has one responsibility: chart = ledger adjustments, expenses = register + record modal, accounts = hub composition. Tasks communicate via URL contracts only (`/expenses?range=today`, `/expenses?new=1`, `/reports/monthly?month=YYYY-MM&branch=ID`, `/day-closing`).

---

### Task 1: Fix chart adjustment missing branchId

**Files:**
- Modify: `apps/web/app/(app)/accounts/chart/page.tsx`
- Test: manual POST + `pnpm --filter goldos-web lint`

**Interfaces:**
- Consumes: `POST /api/v1/accounts/adjustments` requiring `{ debitAccount, creditAccount, amountCents, memo?, reason, branchId, entryDate? }` (see `apps/api/src/routes/accounts.ts:35-49`).
- Produces: working Post-adjustment flow that later tasks rely on for "all functionalities working".

- [ ] **Step 1: Reproduce the omission**

```bash
rg -n "branchId" apps/web/app/\(app\)/accounts/chart/page.tsx
```

- [ ] **Step 2: Run to confirm it fails (branchId collected but never sent)**

Run: `rg -n "branchId: v.branchId" apps/web/app/\(app\)/accounts/chart/page.tsx`
Expected: no matches (exit 1) — form schema at lines 26-33 collects `branchId` and renders a Branch input, but `mutationFn` lines 51-62 never sends it, so the API returns 400 VALIDATION.

- [ ] **Step 3: Implement minimal fix**

```tsx
const adjust = useMutation({
  mutationFn: (v: z.infer<typeof adjustSchema>) =>
    api("/api/v1/accounts/adjustments", {
      method: "POST",
      body: JSON.stringify({
        debitAccount: v.debitAccount,
        creditAccount: v.creditAccount,
        amountCents: Math.round(v.amountLkr * 100),
        memo: v.memo,
        reason: v.reason,
        branchId: v.branchId,
      }),
    }),
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter goldos-web lint`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(app\)/accounts/chart/page.tsx
git commit -m "fix: include branchId in chart adjustment POST"
```

---

### Task 2: Expense register branch scope + branch select

**Files:**
- Modify: `apps/web/app/(app)/expenses/page.tsx`
- Test: `pnpm --filter goldos-web lint`

**Interfaces:**
- Consumes: `GET /api/v1/branches?limit=100` → `{ rows: { id, name }[] }`; `GET /api/v1/expenses?...&branchId=`; `GET /api/v1/expense-categories`; `GET /api/v1/bank-accounts`.
- Produces: `branchId`-consistent register that agrees with dashboard `bq` filtering.

- [ ] **Step 1: Reproduce branch drift**

```bash
rg -n "branchId" "apps/web/app/(app)/expenses/page.tsx"
```

- [ ] **Step 2: Run to confirm gaps**

Run: `rg -n "branchId=\$\{" "apps/web/app/(app)/expenses/page.tsx"`
Expected: no matches — `list` query (lines 109-115) and `summary` query (lines 116-121) build URLs from `page/status/from/to` only, ignoring the `branchId` state (lines 86, 93-96) that the create mutation already sends. Also line 303-309 renders branch as free-text `<input>`.

- [ ] **Step 3: Add branch-scoped queries**

```tsx
const branchQuery = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
const list = useQuery({
  queryKey: ["expenses", page, status, from, to, branchId],
  queryFn: () =>
    api<{ rows: Expense[]; total: number }>(
      `/api/v1/expenses?page=${page}&limit=20${status ? `&status=${status}` : ""}${dateQuery}${branchQuery}`
    ),
});
const summary = useQuery({
  queryKey: ["expense-summary", from, to, branchId],
  queryFn: () => api<{ totalCents: number; pendingCents: number; rejectedCents: number }>(
    `/api/v1/expenses/reports/summary?${dateQuery.slice(1)}${branchQuery}`
  ),
});
const branches = useQuery({
  queryKey: ["branches-for-expenses"],
  queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
});
```

- [ ] **Step 4: Replace branch free-text with select**

```tsx
<label className="block text-sm text-ink-2">
  Branch
  <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlClass}>
    <option value="">Choose a branch…</option>
    {(branches.data?.rows ?? []).map((b) => (
      <option key={b.id} value={b.id}>
        {b.name}
      </option>
    ))}
  </select>
</label>
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm --filter goldos-web lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/expenses/page.tsx"
git commit -m "fix: scope expense register by branch with branch select"
```

---

### Task 3: Dashboard Today-first polish and hub verification

**Files:**
- Modify: `apps/web/app/(app)/accounts/page.tsx`
- Test: `pnpm --filter goldos-web lint`

**Interfaces:**
- Consumes: outputs of Tasks 1-2 (fixed sub-pages); dashboard queries `expenses`, `expenses/reports/summary`, `expenses/reports/daily`, `day-closings/preview`, `day-closings`, `reports/monthly`, `bank-accounts` (all already wired in file lines 258-299).
- Produces: final hub UI — Today section on top, monthly P&L+cash summary, 4 verified NavTiles.

- [ ] **Step 1: Confirm current section order**

```bash
rg -n "where to go|Today|Monthly accounts|Needs your attention" "apps/web/app/(app)/accounts/page.tsx"
```

- [ ] **Step 2: Run to confirm hub tiles exist with correct hrefs**

Run: `rg -n 'href="/expenses"|href="/day-closing"|href=\{monthReportHref\}|href="/accounts/chart"' "apps/web/app/(app)/accounts/page.tsx"`
Expected: 4+ matches (NavTiles lines 387-414 plus footer CardLinkRows). If any missing, that is the failure to fix.

- [ ] **Step 3: Apply Today-first polish (minimal, no logic change)**

```tsx
{/* Keep Hero stats order: Spent today, Cash expected, Spent this month, Net profit */}
{/* Keep NavTiles grid directly under Hero (hub entry to all sub-pages) */}
{/* Keep Today H2 + 4 KpiCards + Today's-expenses (8 rows) + Day-closing panels before Monthly section */}
{/* Monthly section: month input max={today.slice(0,7)} + This-month reset already at lines 596-609 — keep */}
{/* Visual only: ensure Today H2 uses text-lg font-semibold, panels keep icon+description+footer link, chart keeps posted #C9A227 / pending #E7C65A */}
```

Concrete edit: only touch copy/classes if a check fails — e.g. ensure `longDate(today)` heading exists at line 421, `description="Today's spending, the drawer, and the month's books — everything the shop owner checks, in one place."` stays, and every `Panel` keeps its `footer={<CardLinkRow ...>}` link. Do not add new queries or state.

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter goldos-web lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/accounts/page.tsx"
git commit -m "feat: polish accounts dashboard today-first hub hierarchy"
```

---

### Task 4: Full verification (build + regression + manual pass)

**Files:**
- Test only: no source edits; evidence in commit message / PR notes.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: shippable verification proof.

- [ ] **Step 1: Run web typecheck**

Run: `pnpm --filter goldos-web lint`
Expected: exit 0.

- [ ] **Step 2: Run web production build**

Run: `pnpm --filter goldos-web build`
Expected: exit 0, no prerender failures for `/accounts`, `/expenses`, `/day-closing`, `/reports/monthly`, `/accounts/chart`.

- [ ] **Step 3: Run API regression suites (backend untouched, must stay green)**

Run: `pnpm --filter api test 2>&1 | tail -30`
Expected: suites for `expenses`, `monthly`, `dayclose`, `reconcile` pass; zero failures. If filter name differs, run `pnpm test` from repo root and note results.

- [ ] **Step 4: Manual hub pass (record evidence, fix nothing here — file follow-ups instead)**

```text
1. /accounts loads: Hero stats show Spent today / Expected cash / Month spend / Net profit.
2. Branch switch updates Today list, chart, P&L, closing status.
3. Month switch updates KPIs, daily chart, category bars, P&L/cash/owed panels.
4. Tiles navigate: Expenses, Day closing, Monthly report (month+branch preserved), Chart.
5. /expenses?new=1 records cash + bank expense; appears in Today's list as POSTED or PENDING_APPROVAL.
6. /accounts/chart Post adjustment with branch succeeds (Task 1 proof).
7. /day-closing preview + close/reopen flow unchanged.
8. 403 case: user without accounts:manage sees dashboard but no Record/Add/Adjust buttons.
```

- [ ] **Step 5: Commit verification note (empty commit only if all green)**

```bash
git log --oneline -4
```

No code commit in this task; attach Step 1-4 outputs to PR / handoff message.

---

## Self-Review

1. **Spec coverage:** Hero+branch/month selectors → Task 3; 4 NavTiles hub → Task 3 Step 2; Today KPIs+list+closing → Task 3; Monthly KPIs+chart+categories+P&L+cash+owed → Task 3; Needs-attention → Task 3 (kept conditional block lines 797-830); Bug fix 1 (chart branchId) → Task 1; Bug fix 2-3 (expense select+scope) → Task 2; Bug fix 4 (href/back-link verify) → Task 2-3; Error/empty states, toasts → kept, verified in Task 4; Testing matrix → Task 4.
2. **Placeholder scan:** no TBD/TODO/appropriate-handling vagueness — every step has exact file, exact snippet, exact command, exact expectation.
3. **Type consistency:** `branchId: string` throughout; `amountCents = Math.round(amountLkr*100)` matches API `amountCents: int>0`; query keys include `branchId` consistently in Task 2; URL param is `branchId` except monthly page which uses `branch` query + `branchId` API param — preserved via existing `monthReportHref`, not renamed.
