# GoldOS — Inventory Page Premium UI

Date: 2026-09-29
Status: Approved
Scope: Redesign of `/inventory` only. Adds one read-only API endpoint and a set of additive shared UI primitives. No schema migration, no changes to inventory business rules, no changes to the existing `POST /inventory/movements` contract.

## 1. Context

`apps/web/app/(app)/inventory/page.tsx` is a 278-line page built from the plain `components/ui.tsx` primitives. It has three sections: a stock table grouped by branch/purity/product, a flat five-input "Record movement" form, and a movement history table with hardcoded `limit=30`.

The dashboard (`app/(app)/dashboard/page.tsx`, 963 lines) already established a premium visual language for this product — dark `bg-void` heroes with `home-grid-bg` texture and gold drift glows, gold-gradient icon chips, `SpotlightCard` pointer-tracking, count-up metrics, an SVG gauge ring, a dark "Board rates" card with per-row gradient bars, and a green "All clear" empty state. Inventory does not use any of it, so the two most important pages in the product look like they came from different apps.

The dashboard achieves this by defining ~8 local components inside the page file. Doing the same in inventory would be a third divergent copy of the same gradient and card code, in another 900-line file.

User-confirmed decisions:
- Scope is visual **plus new data panels** (charts and an alerts card), not visual-only.
- New panels are: **charts** (stock by karat, stock by branch) and **needs attention** (alerts). No movement timeline, no scan command bar, no separate stock-composition panel.
- Backend work is limited to **small additive read-only endpoints**; no service refactor.
- Structure: **additive shared primitives in `components/ui.tsx`**, inventory rebuilt on them, dashboard left untouched as the visual reference.

## 2. Goals

1. Inventory reads as the same product as the dashboard — same hero treatment, same card language, same motion.
2. An operator opening the page answers "where is my gold, what is it worth, what needs my attention" in one screen without scrolling to a table.
3. The premium look becomes reusable, so the next data page is cheap rather than another 900-line file.
4. Charts, hero totals, and the stock table can never disagree on value.

## 3. Non-goals

- Changing movement transition rules, approval gates, or count/transfer routing. The existing `ALLOW` map in `services/inventory.ts` and the `CONFLICT` refusals for `SOLD`/`LOST`/`VOID` are unchanged.
- A product-detail page. Row click opens a modal on this page.
- Touching the dashboard or the other 24 pages.
- Adding a UI component library dependency. Recharts and the Tailwind theme already in `tailwind.config.ts` are sufficient.
- Marketing visuals from `components/home/*` (marquee, twinkle, tilt, drift-heavy decoration) being promoted into app UI.

## 4. Page structure

Single column inside `Page` (`max-w-7xl`, `space-y-5`).

### 4.1 Dark hero

Replaces the current `Hero` usage. Built from the dashboard's hero pattern rather than the `ui.tsx` `Hero` component, so the two pages share a visual signature:

- `bg-void`, `rounded-3xl`, `shadow-5`, `home-grid-bg` overlay, two `home-drift` gold glows, `home-noise`, and a top hairline gradient rule.
- Left: kicker pill "Inventory" (gold, `animate-pulse-soft` dot), `g-display` title, one-line description, then two actions — `Scan to move stock` (`home-btn-gold` → `/scan`) and `Record movement` (`home-btn-gold` secondary that scrolls to and focuses the movement panel).
- Right: a `GaugeRing` showing **stock value as a share of a gold-denominated target**, with total LKR and fine grams beneath. The target is the largest single per-karat stock value, i.e. the ring reads as "how the top karat compares to the rest" — this is a *composition* gauge, not a capacity gauge, because no capacity target exists in the data model. If there is no priced stock the ring renders a neutral track at 0 and the caption reads "No priced stock".
- Bottom: 4-cell stat strip (Pieces on hand / Net weight / Fine gold / Stock value) with per-cell icon chips, `g-metric` values, and the dashboard's gold-fill hover.

Total LKR and fine grams come from `insights.totals`, not from the tab-dependent `stock` query, so the hero stays stable while the user switches grouping.

### 4.2 Insight row

Three cards on `xl:grid-cols-3`.

**Stock by karat** — dark card (`bg-void`, `rounded-2xl`, `shadow-4`), same construction as the dashboard's `RatesPanel`. One `BarList` row per karat: karat chip (`g-metric`, gold tint), bar scaled to that karat's share of total fine gold, and pieces / grams / LKR on the right. Sorted by fine gold descending. Empty state: dashed-border block, "No stock on hand".

**Stock by branch** — light `SpotlightCard`. Same `BarList` with the `ink` ramp. Shows branch **name** (the current stock endpoint returns raw branch UUIDs, which is why the table's first column is a mono id; the insights endpoint joins `branches` and the chart uses names). Net grams + piece count on the right.

**Needs attention** — light card. Rows only when the condition is non-zero, each tinted by severity:

| Row | Condition | Tone |
|---|---|---|
| Transfers in transit | `transfer_pending > 0` | warning (amber) |
| In repair | `in_repair > 0` | info (gold) |
| Reserved | `reserved > 0` | neutral |
| No movements logged | `last_movement_at == null` | warning |
| Quiet for a while | last movement older than 7 days | warning |
| Healthy | all of the above zero and a movement exists | green "All clear" |

Each row links somewhere useful: the in-transit and repair rows link to the movement history pre-filtered by that type; the "no movements"/"quiet" rows link to `/products` (the catalog, where the operator reconciles what is missing). When all rows are clear the card shows the dashboard's green ping "All clear" block.

### 4.3 Stock on hand

`TableCard` wrapping a `DataTable`:

- `groupBy` `Tabs` move into the `toolbar` slot, on the right of the card header.
- Sticky `thead` so the header survives a long product list.
- The `Fine` column carries a micro-bar: a 1px-track div whose gold fill is the row's fine/net ratio, with the gram figure right-aligned.
- A `totals` row pinned in the table footer area, always showing the aggregate for the current grouping.
- Clicking a row opens a detail `Modal`: barcode, status `StatusPill`, branch, purity, net / fine grams, cost, and a "View product" link to `/products` plus a "Record movement" action that prefills the movement form's barcode. Product row fields are already available from `GET /products/barcode/:code`, so this is a second call on click, not a new endpoint.

### 4.4 Record movement

The flat `grid-cols-5` input row becomes a two-column `Panel`:

- **Left — scan.** Barcode input, autofocus, `font-mono`, Enter submits. Below it, a `PiecePreview` card. Typing (debounced 400 ms) or blurring calls `GET /api/v1/products/barcode/:code` and renders the piece: status pill, branch, net grams, purity, cost. Unknown barcode renders an inline `Callout tone="danger"`. This is the single biggest UX win on the page: today the operator finds out a barcode is wrong only after submitting.
- **Right — post.** `Field`-wrapped to-status select (the same three options: `IN_STOCK`, `RETURNED`, `TRANSFER_PENDING`), to-branch input (required when status is `TRANSFER_PENDING`, enforced client-side), reason input, and the Record button. The to-branch field's required state is driven off the status selection rather than left to the server's `VALIDATION` error.
- A `Callout` at the panel foot restates the routing rules the current `description` string carries: sales go through POS, shortages through counts, voids through the product page.

The mutation body, the barcode→product-id resolution, the `toast` handling and the `["moves"]` / `["stock"]` invalidations are unchanged.

### 4.5 Movement history

Still a table — it is a ledger and tabular is the correct form. Improvements:

- Real pagination through `Pager`, replacing the hardcoded `limit=30`. The service already supports `page`/`limit`/`search`.
- Type filter as `FilterChips` instead of a `<select>`.
- Branch filter as a `<select>` populated from a branches query, instead of a free-text field that takes a raw id.
- A barcode/reason search box wired to the existing `search` param that `listMovements` already implements and the current UI ignores.
- `StatusPill` on the from→to transition (so `TRANSFER_PENDING` reads as info, `LOST` as danger) instead of the neutral pill used today.
- Per-row type icon in a small tinted chip.

## 5. Shared primitives

All additions to `apps/web/components/ui.tsx`; nothing existing is modified. The dashboard is not refactored onto them in this slice.

`BarList` and `DataTable` take a `SortState`/`format` pair rather than a bare number wherever a value is money or weight, so the shared kit never hardcodes `en-US` grams or LKR formatting — that stays with `@goldos/shared`'s `mgToG`/`centsToLkr` and the calling page.

| Export | Contract |
|---|---|
| `MetricCard` | `{ label, value: number \| undefined, format, unit?, prefix?, sub?, icon, href?, loading?, tone? }`. Spotlight pointer-tracking, count-up on mount, gold underline sweep on hover. `value === undefined` renders the em-dash placeholder without animating. |
| `BarList` | `{ items: Array<{ key, label, value, secondary?, href? }>, ramp?: "gold" \| "ink", format?, empty? }`. Bar width = `value / max`; each row animates its fill in on mount with a per-row delay. |
| `GaugeRing` | `{ value, max, caption, label? }`. SVG donut with a gold-gradient stroke, rotating tick marks, and a `stroke-dashoffset` transition. Generalises the dashboard's hardcoded `TodayGauge`; the dashboard keeps its own copy in this slice. |
| `DataTable` | `{ columns, rows, rowKey, totals?, onRowClick?, loading?, empty? }` where each column is `{ key, label, align?, width?, render, sortable?, value? }`. Sticky header, client-side sort via `value`, `g-table` styling preserved, loading/empty delegated to `TableSkeleton`/`EmptyBlock`. Pagination stays with the caller through `Pager` in `TableCard`'s `footer` slot, since only the movements table is paged. |
| `FilterChips` | `{ options: Array<{ key, label, count? }>, value, onChange, ariaLabel }`. Single-select pill row. |
| `Field` | `{ label, hint?, error?, icon?, children }` around `controlClass`, with label/hint/error wiring and `aria-describedby`/`aria-invalid`. |

`useCountUp` is hoisted from `dashboard/page.tsx` into `apps/web/lib/count-up.ts` and both the new `MetricCard` and the dashboard import it. This is a pure move, not a behaviour change.

`apps/web/app/(app)/inventory/` becomes a directory:

```
page.tsx     — composition, queries, mutation, state
panels.tsx   — StockByKarat, StockByBranch, AttentionCard, PiecePreview, MovementFilters
columns.tsx  — DataTable column descriptors for the two tables
```

All three are inventory-specific and are not promoted to the shared kit. Target file sizes stay under ~250 lines each.

## 6. API

New read-only endpoint, no migration:

```
GET /api/v1/inventory/insights
→ { totals: { pieces, net_mg, fine_mg, value_cents },
    byKarat: [{ karat, permille, pieces, net_mg, fine_mg, value_cents }],
    byBranch: [{ branch_id, name, pieces, net_mg, fine_mg, value_cents }],
    attention: { transfer_pending, in_repair, reserved,
                 last_movement_at, movements_24h } }
```

Backed by `inventoryInsights(db)` in `apps/api/src/services/inventory.ts`, routed from `apps/api/src/routes/inventory.ts` behind `requirePerm(PERMISSIONS.PRODUCTS_VIEW)` and the existing `requireAuth`.

- `totals`, `byKarat`, `byBranch` cover `status = 'IN_STOCK'` only, matching `stockSummary`'s scope so the hero and the table agree.
- Value is computed with `currentGoldRatesCents(db)` and the same `net_mg * rate / 1000` arithmetic as `stockSummary`, so hero, charts, and table cannot drift apart.
- Missing rates contribute `0`, and a response with no published rates yields `value_cents: 0` throughout rather than an error — the UI already handles the "no value" case and must keep doing so.
- `byKarat` joins `purities` for `karat` and `permille`; `byBranch` joins `branches` for `name`.
- `attention` counts non-`IN_STOCK` statuses, and reads `MAX(created_at)` plus a 24-hour count from `stock_movements`.
- Three prepared statements plus one rates read, all already indexed (`products.status`, `stock_movements.created_at`).

## 7. Data flow

```
me (permissions) ─┐
                  ├─ insights ──► Hero gauge + stats, BarLists, AttentionCard
stock[groupBy] ───┘     │
                        └─► DataTable (totals footer) + row-click detail modal
movements[page,filters] ──► MovementHistory DataTable
branches ──────────────► branch select, StockByBranch labels
barcode input ──► debounced products/barcode/:code ──► PiecePreview
                             └─(submit)─► POST /inventory/movements ─► toast
                                          └─► invalidate ["insights"],["stock"],["moves"]
```

Query keys: `["inventory","insights"]`, `["stock", groupBy]`, `["moves", page, type, branch, search]`, `["branches"]`. The detail modal and the movement prefill share one piece lookup, so opening a row and then moving it does not re-fetch.

## 8. Error and empty handling

Every panel has all four states. Nothing renders a bare `—` without explanation.

- **Loading:** `Skeleton` in hero stats and `BarList`; `TableSkeleton` in tables. Charts show a pulsing plot-area placeholder, not an empty axis.
- **Error:** panels show a `Callout` with the message and a Retry button that refetches the single query. A failed `insights` call does not blank the page — the stock table and movement history are independent queries and stay live.
- **No data:** per-panel copy that tells the operator what to do ("No stock on hand. Intake a purchase or run a count to get started."), plus a link to the action that fixes it.
- **No priced stock:** value-dependent UI (gauge fill, LKR figures, value-sorted bars) falls back to a neutral track and an explanatory caption; the rest of the page stays normal.
- **Empty states link somewhere:** every empty panel names the action that resolves it and links to it, rather than only describing the absence.
- **Movement failure:** existing `toast.error` with the server's message, which is the useful one (`Transition X → Y not available in this phase`).

## 9. Accessibility

- Tabs keep `role="tablist"` / `aria-selected`. `FilterChips` follows the same pattern.
- `DataTable` renders a real `<table>` with `<caption className="sr-only">`; sortable headers are `<button>`s with `aria-sort`.
- `Field` wires `htmlFor`, `aria-describedby` for hints, and `aria-invalid` for errors; the barcode error is also announced via `role="alert"`.
- The gauge ring is `aria-hidden` with the value exposed as text in the adjacent caption — a chart is never the only carrier of a number.
- All decorative gradients, glows, and grid textures are `pointer-events-none` and `aria-hidden`.
- Focus rings use the existing `focus:shadow` gold ring, never removed.

## 10. Performance

- All four page queries are independent, so they render as each resolves; the hero waits only on `insights`.
- `staleTime: 60_000` on `insights` and `branches`, matching the dashboard.
- Bar fills and gauge use CSS transitions on mount, not a JS animation loop.
- `BarList` renders at most 8 karats (all real karat lines) and 10 branches; beyond 10 the list shows the top 10 and an "and N more" footer, so the DOM stays small.
- Every animation respects `prefers-reduced-motion`: `useCountUp` snaps to the target, and the bar/gauge transitions are suppressed by a `motion-reduce:transition-none` variant on the new primitives.

## 11. Testing

- **Service test** — new `apps/api/src/services/inventory-insights.test.ts` using the same hand-rolled D1 stub harness as `inventory-correctness.test.ts`:
  - karat aggregation sums net and fine correctly across rows
  - value uses the per-karat rate and rounds the same way `stockSummary` does
  - a product with no published rate contributes `0` value, not `NaN` and not a throw
  - attention counts pick up non-`IN_STOCK` statuses and 24-hour movement count
  - no in-stock rows returns zeroed totals with empty arrays, not `null`
- **No web tests** — `apps/web` currently has `"test": "echo 'no web tests yet' && exit 0"`. Adding a component test runner is out of scope for this slice, and it is a deliberate omission rather than an oversight.
- **Verification:** `pnpm --filter goldos-web lint` (which is `tsc --noEmit`) and `pnpm --filter @goldos/api test`, plus a manual pass over: grouped tabs, row-click modal, movement prefill, the three status options, pagination, filters, and each empty state.

## 12. Risks

| Risk | Mitigation |
|---|---|
| `ui.tsx` is imported by 25 pages; a bad change breaks all of them | Additive only — no existing export is edited. `tsc --noEmit` over the whole web app catches signature drift. |
| Hero total drifts from the stock table's total | Both derive from the same pricing function; the hero reads `insights.totals`, never the tab-dependent query. |
| A 963-line precedent exists for page-local components, so shared primitives feel inconsistent | This spec's whole argument is that the dashboard is the *first* occurrence and inventory is the *second*; the pattern pays off from here. `BarList` and `Field` are generic, not inventory-shaped. |
| Product grouping can be long and re-queries on every tab switch | `staleTime` on the stock query plus a memoised total row; the tab is the intended interaction, not a regression. |
| `SELECT` from a free-text branch field to a populated select | Strictly fewer invalid states than today, where a mistyped id silently returns zero rows. |
