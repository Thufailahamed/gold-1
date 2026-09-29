# Accounts Dashboard Hub Polish — Design

Date: 2026-09-29
Approach: Hub polish (approved)
Scope: single spec → single implementation plan

## Problem
Shop owners struggle to calculate daily expenses and monthly accounts. They need today's spend and the month's books in one obvious place, with expenses fully visible.

## Decisions (from brainstorming)
- Sidebar: keep as-is — only `Accounts Dashboard` under Accounts. Expenses, Day Closing, Monthly Report, Chart of Accounts stay hidden from sidebar, reachable only via dashboard hub tiles.
- Daily priority: Today total + list first (posted vs pending, entry list).
- Monthly: P&L + cash summary inline on dashboard; full detail lives on `/reports/monthly`.
- Functionality: no known breakage reported; fix hidden bugs + polish UI.

## Architecture
- No new routes. Hub page: `apps/web/app/(app)/accounts/page.tsx`.
- Sub-pages (unchanged routes): `/expenses`, `/day-closing`, `/reports/monthly`, `/accounts/chart`.
- Sidebar: `apps/web/components/app-sidebar.tsx` — no change (verified single Accounts entry).
- Backend: no schema/API changes. Reuse:
  - `GET /api/v1/expenses?from=&to=&status=&branchId=`
  - `GET /api/v1/expenses/reports/summary?from=&to=&branchId=`
  - `GET /api/v1/expenses/reports/daily?from=&to=&branchId=`
  - `GET /api/v1/day-closings/preview?branchId=&date=`
  - `GET /api/v1/day-closings?limit=`
  - `GET /api/v1/reports/monthly?month=&year=&branchId=`
  - `GET /api/v1/bank-accounts`, `GET /api/v1/branches`
- Follow existing patterns: React Query (`retry:false`, `staleTime:30s`), `Hero/Page/Panel/KpiCard/NavTile` from `components/ui`, `lkr()` cents→LKR formatting, permission gates via `hasPermission`.

## Layout (top → bottom)
1. **Hero context bar**: kicker Accounts, title, branch `<select>` (All branches for `branches:manage`, else visible only), `Record expense` (requires `accounts:manage`), `Close the day` link. Stats: Spent today, Cash expected in drawer, Spent this month, Net profit this month. Note: business date + ledger-live copy.
2. **Where-to-go hub (4 NavTiles)**: Expenses (pending count stat), Day closing (open/closed stat per branch), Monthly report (net profit stat, href preserves `?month=&branch=`), Chart of accounts (double-entry copy).
3. **Today section (priority)**: H2 with long date. 4 KpiCards: Spent today (link `expenses?range=today`), Sales today, Cash in drawer expected (link day-closing), Bank balance. Panels row: `Today's expenses` (up to 8 rows: description, category, number, StatusPill, amount; footer link to register) + `Day closing` (Closed/Open pill, expected cash, checks callout, awaiting-approval note, recent 4 closings).
4. **Monthly section**: H2 month name + `<input type=month max=today>` + This-month reset. 4 KpiCards: Sales net, Expenses (pending sub or daily avg), Net profit (Signed), Closing cash. Panels: `Daily expenses` stacked BarChart (posted `#C9A227` + pending `#E7C65A`, zero-filled calendar, month total / daily avg / busiest day mini-stats) + `Where the money went` BarList top-7 categories. Then 3 panels: Profit & loss (Revenue, COGS, Gross, Opex, Net), Cash flow (Opening, In, Out, Closing), Owed to & by shop (receivables/payables totals + counts), each footer-links to full monthly report.
5. **Needs attention** (conditional): pending-approval expenses list + monthly warnings list.

## Data flow
- `businessToday()` + `monthBounds(month)` derive `from/to`; `branchId` from cookie default → first visible branch; `ready` gates all queries.
- `chartData` zero-fills days (quiet day = 0, not missing); `peak`, `avgPerDay`, `todayPosted/Pending`, `closedToday`, `categories` sorted desc, `bankTotal` from active accounts — all `useMemo` derived client-side.
- Mutations: none on dashboard itself (record expense navigates to `/expenses?new=1`; close navigates to `/day-closing`).

## Bug fixes (frontend only)
1. `accounts/chart` adjustment: `mutationFn` omits `branchId` but API `adjustSchema` requires it → include `branchId` in POST body. File: `apps/web/app/(app)/accounts/chart/page.tsx`.
2. `expenses` record modal: branch is free-text `<input>` → replace with branch `<select>` populated from `GET /branches`, default from cookie. File: `apps/web/app/(app)/expenses/page.tsx`.
3. `expenses` list + summary ignore branch: add `branchId` to query strings and `queryKey`s so dashboard (`bq`) and register agree. Same file.
4. Verify month-report href preserves branch (`monthReportHref` already does) and back-links (`back:{href:/accounts}`) on all sub-pages — keep.

## Error handling / empty states
- Loading: `Skeleton` per panel/chart; error: `EmptyBlock` with message; zero-data: "No expenses today / this month" copy (already present — keep).
- Day closing blocked states: failing checks (danger Callout), unclassified cash (warning Callout), awaiting approval (info Callout) — keep.
- Toasts on mutations (expenses create, chart adjustment, day close) — keep; no silent failures.

## Testing
- Frontend: `pnpm --filter web build` / typecheck; manual pass: branch switch, month switch, today list, chart, P&L/cash panels, tile navigation, record-expense modal, chart adjustment with branch.
- Backend (no changes, regression only): `vitest` suites for `expenses`, `monthly`, `dayclose`, `reconcile` if touched indirectly.
- Permissions matrix: `accounts:view` sees dashboard; `accounts:manage` sees Record/Add/Adjust; `branches:manage` sees All-branches option.

## Out of scope (YAGNI)
- No new charts library, no export-on-dashboard (export stays on monthly page), no sidebar changes, no API/schema changes, no notification center work, no unrelated refactoring.
