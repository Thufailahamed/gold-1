# GoldOS — Branch Overview Design (Slice 4 of Advanced Inventory)

Date: 2026-09-28
Status: Approved (composed reads, MTD via monthly engine, staff managers-up only)
Scope: Per-branch consolidated read view — jewellery, gold, cash, banks, staff, MTD sales/purchases — plus an all-branches array view. Read-only, no new tables, no writes. After this slice the inventory track is complete; monthly Slices 2–3 remain.

## 1. Context

Every per-branch source exists: IN_STOCK products with `branch_id`, `heldGoldMg(db, branchId)` by stage, journal `1000`/`1020`/`1030` balances per branch, bank accounts with ledger balances and optional branch scope, `branch_members` + users/roles, and `buildMonthlyReport(db, { month, year, branchId })` for sales/purchases. What is missing is one screen per branch and the owner's side-by-side view — with a structural guarantee that branches never mix.

User-confirmed decisions:
- Sales/purchases are month-to-date with a month picker, computed by the monthly engine.
- Staff names are visible to owner/manager/accountant (`users:view`) and same-branch members only.

## 2. Endpoints (`/api/v1/branch-overview`)

- `GET /branch-overview?branchId=&month=&year=` (`branches:view`, member of the branch or `branches:manage`): `{ branch, asOf, jewellery: { pieces, netMg, fineMg, costCents, hasData }, gold: { stages, fineMg, hasData }, cash: { drawer, cardClearing, hasData }, banks: [{ name, balanceCents, shared }], staff: [...] | { redacted: true }, sales: { netCents, invoiceCount }, purchases: { valueCents }, transit: { linesIn, linesOut, cashInTransit } }`. Bank list = accounts with `branch_id = branch` plus unscoped head-office accounts flagged `{ shared: true }` — labeled shared, never counted as branch cash.
- `GET /branch-overview/all?month=&year=` (requires `branches:manage`): `{ asOf, branches: [<same shape>] }` — an array with no `total` key by design. CSV is per-branch only (`?format=csv` needs `audit:export` + live-read preamble); `/all` never exports, so no mixed file can exist.
- Jewellery values book `cost_cents` (book-cost chain, never board rate); weights exact mg. Cash `drawer` is the `1000` journal balance; card clearing `1020`; 1030 and IN_TRANSIT lines live under `transit` only. Stock/cash/gold carry `asOf` (live snapshot); sales/purchases carry the month window — the two are labeled apart so drawer cash can't be read as month-end cash.
- Staff: full `[{ name, roles }]` when caller holds `users:view` or is a member of the branch; otherwise `{ redacted: true }`.

## 3. No-mix rule (structural)

- The all-branches response is an array of independent branch objects; the service computes each branch with an explicit `branch_id` filter and has no code path that sums across branches.
- In-transit lines (TRANSFER_PENDING products, 1030 balances, unreceived transfer lines) are attributed to neither branch's shelf/drawer figures — they appear only under `transit`.
- BranchId is always required for the single view; `/all` is manage-only. No mixed default.

## 4. Testing

- No-mix: two seeded branches → `/all` response has no `total` key and branch figures equal single-view figures.
- Reuse: branch sales/purchases equal `buildMonthlyReport` output for the same inputs.
- Redaction: non-member without `users:view` → `{ redacted: true }`; member → names; `users:view` holder → names anywhere.
- Transit: IN_TRANSIT product in neither branch's jewellery count; 1030 balance outside `drawer`.
- Empty branch: zeros with `hasData: false` per section.
- Perms: single view of foreign branch without manage → 403; `/all` without manage → 403; CSV without `audit:export` → 403.

## 5. Out of scope

- Monthly Slices 2–3 (aging + valuation, CSV exports + dashboard).
- Any write path (all resolution stays in counts/transfers endpoints).
- Web UI (later slice; these endpoints are its contract).
