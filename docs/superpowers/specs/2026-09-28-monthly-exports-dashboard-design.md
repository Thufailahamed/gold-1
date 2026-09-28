# GoldOS — Monthly Exports & Dashboard Design (Slice 3 of Monthly Reporting)

Date: 2026-09-28
Status: Approved (server CSV, print-to-PDF, SheetJS xlsx, recharts, full trends + KPIs)
Scope: Per-section server CSV, the monthly report page with print + xlsx export, and the owner analytics dashboard. Closes the monthly track (core + aging/valuation shipped).

## 1. Context

The monthly JSON (`GET /reports/monthly`, incl. receivables/payables/inventory since Slice 2) is the single source of truth. The sales reports page already builds browser CSV from JSON via Blob; the discrepancies routes serve server CSV via the shared `toCsv` escaper with an `audit:export` gate. No chart or xlsx library is installed. This slice wires all four surfaces (screen, CSV, xlsx, print) to the same JSON so they cannot disagree.

User-confirmed decisions:
- Charts: recharts (new dep).
- Excel: SheetJS `xlsx` (new dep), client-side multi-sheet workbooks from the report JSON.
- Dashboard: 12-month trends + current-month KPIs + aging/inventory panels.

## 2. Server CSV

`GET /reports/monthly?month=&year=&branchId=&format=csv&section=sales|purchases|gold|expenses|profit|cashflow|receivables|payables|inventory` — requires `audit:export` (checked after the existing `accounts:view` + branch gate). Sections flatten with the shared `toCsv` escaper: sales (gross/returns/net/count), purchases (values + fine mg), gold (per-flow mg + opening/closing), expenses (per-category + pending), profit (revenue/COGS/gross/opex/net legs), cashflow (opening/in/out/closing + unclassified), receivables/payables (party lines, then bucket rows), inventory (groups + basis/method rows). Preamble `#` lines: `generated_at, month, branch, basis, source: ledger-posted` (live data, not a frozen snapshot — stated). Unknown section → 400 VALIDATION. JSON responses byte-identical to today.

## 3. Monthly report page

`/(app)/reports/monthly` (client component, TanStack Query): month + year selects, branch dropdown (member branches; shop-wide for `branches:manage`), section cards for all ten sections with `hasData` empty states, Ledger/Estimate badges, per-section CSV links (Section-2 endpoint via Blob save), freeze-snapshot button (`accounts:manage`, note field when warnings), "Export .xlsx" (SheetJS: one sheet per section from the rendered JSON). Print stylesheet: hide nav/pickers/buttons, expand all cards, preamble header — browser Print-to-PDF, no server PDF. Sidebar "Monthly Reports" link (`accounts:view`).

## 4. Owner analytics dashboard

`/(app)/analytics` (requires `branches:manage` + `accounts:view`, others redirected): month/branch pickers; KPI cards (net sales, gross/net profit, closing cash, gold closing mg, receivables, payables — Ledger-badged, month-labeled); recharts 12-month revenue-vs-net line chart, monthly cash in/out bars, gold in/out bars (mg), horizontal aging-bucket bars, inventory-by-purity donut; estimates in a separate badged panel. Trend data: 12 parallel monthly queries (`staleTime` 5 min); failed months render as gaps, never interpolated; empty shop renders zero-state copy, not zero charts. `ResponsiveContainer` throughout; sidebar "Analytics" link.

## 5. Dependencies

Add to `apps/web`: `recharts` (pinned major per install date, exact version recorded in the plan), `xlsx` (SheetJS). No server-side PDF/Excel libs (Workers constraint stands).

## 6. No-fabrication guards

- Screen, CSV, xlsx, and print all derive from the same fetched JSON.
- Gaps stay gaps (no smoothing/interpolation); empty states are copy, not zeros.
- Estimates never appear in profit/net tiles; every tile carries its basis badge.

## 7. Testing

- API: per-section CSV test (header + preamble + escaping) for two sections (profit, receivables) + unknown-section 400 + CSV without `audit:export` → 403.
- Web has no test runner (`echo 'no web tests yet'`): verification is `tsc --noEmit`, `next build`, and manual checklist (pickers refetch, CSV downloads, xlsx opens with 10 sheets, print preview shows all cards, dashboard gaps on failed month).
- No regressions: full `pnpm test` green.

## 8. Out of scope

- Server PDF/Excel generation. Ad-hoc date ranges (month windows only). Budgets/targets/comparisons. Web UI for inventory/repair/order slices (separate track).
