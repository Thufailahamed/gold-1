# Cheque + Part-Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customer sales take cheques and part-payments with pending/cleared/bounced tracking and no lost debt.

**Architecture:** Add a `cheques` table linked to sale payments and receipts; treat a PENDING cheque as paid for settlement but visible separately, post its money leg to Customer Receivables (1200) at sale time and move it to bank only on clearance; expose clear/bounce as audited status transitions with day-close enforcement.

**Tech Stack:** Cloudflare D1 (SQLite) + Drizzle `schema.ts`, Hono API, Zod in `packages/shared`, Next.js web POS, Expo mobile POS, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-cheque-part-payments-design.md`

## Global Constraints

- Engine is Cloudflare D1 (SQLite); migrations are new sequential SQL files in `apps/api/drizzle/`, never edit an applied migration; mirror every change in `apps/api/src/db/schema.ts`.
- Every money/gold write posts its journal entry atomically via `db.batch`; corrections are VOID / REVERSE with reason + user + timestamp, never DELETE or UPDATE of money rows; no hard deletes of business records.
- Every write batches its `audit_logs` row; every journal entry names a `branchId` and uses shop-local `entry_date` (`businessDateFor`, `business_tz_offset_minutes`); closed-day postings are refused (`buildEntryStmts` + `trg_journal_day_lock`).
- Sale creation requires Σ payments == total; `paid_cents/status` are recomputed by `settlementStmt()`, never trusted; receipts allocate FIFO oldest-first.
- Validation lives in Zod (`packages/shared/src/schemas.ts`); API speaks LKR, DB stores cents; weights in mg, money in cents.
- Cheque requires a customer (create on the spot in UI); no cash change when a cheque or credit leg is present; cheque amount capped at amount-due; PENDING counts as paid with a separate pending list; BOUNCED returns to owed; CLEARED moves the leg to bank.
- Voiding a sale or cheque-bearing receipt cancels linked PENDING cheques (status VOID + audit); history (`bank` + note rows) stays frozen, no backfill.

## Review Focus

- Bounced cheque after gold handed over still shows as owed and collectible, never silently paid.
- Overpay-by-cheque with cash change is refused (no cash-out on a cheque overpay).
- Cheque without a customer is refused (no unchasable pending cheque).
- Duplicate cheque number + bank + amount while PENDING is refused (no double-present of one leaf).
- Clear/bounce on a CLOSED business day is refused with the day-lock error, not posted.

---

### Task 1: Cheques table, schema mirror, shared validation

**Files:**
- Create: `apps/api/drizzle/0046_cheques.sql`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `packages/shared/src/schemas.ts`
- Test: `apps/api/src/services/cheques-foundation.integration.test.ts`

**Interfaces:**
- Consumes: none (foundation).
- Produces: `cheques(id, branch_id, customer_id, invoice_id NULL, receipt_id NULL, sale_payment_id NULL, cheque_number, bank_name, cheque_date TEXT YYYY-MM-DD, amount_cents, status PENDING|CLEARED|BOUNCED|VOID, cleared_on NULL, bounced_on NULL, bounced_reason NULL, replacement_receipt_id NULL, created_at, created_by)`; `splitPaySchema.method` includes `"cheque"` with optional `cheque: { number, bankName, chequeDate }`; `customerReceiptSchema.method` includes `"cheque"` with same `cheque` object; `isBusinessDate(v: string) => boolean` reused for cheque dates.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/cheques-foundation.integration.test.ts
import { describe, expect, it } from "vitest";
import { createSaleSchema, customerReceiptSchema } from "@goldos/shared";
it("accepts a cheque leg with number/bank/date", () => {
  const r = createSaleSchema.safeParse({ branchId: "b1", items: [{ productId: "p1" }], payments: [{ method: "cheque", amountLkr: 10, cheque: { number: "123456", bankName: "BOC", chequeDate: "2026-10-13" } }] });
  expect(r.success).toBe(true);
});
it("refuses a cheque leg without details", () => {
  const r = createSaleSchema.safeParse({ branchId: "b1", items: [{ productId: "p1" }], payments: [{ method: "cheque", amountLkr: 10 }] });
  expect(r.success).toBe(false);
});
it("accepts a cheque receipt", () => {
  const r = customerReceiptSchema.safeParse({ customerId: "c1", branchId: "b1", amountCents: 1000, method: "cheque", cheque: { number: "1", bankName: "B", chequeDate: "2026-10-13" } });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-foundation.integration.test.ts`
Expected: FAIL (unknown method `cheque`, missing `cheque` object).

- [ ] **Step 3: Implement migration `0046_cheques.sql` (CREATE TABLE + indexes, no edits to old files)**

Table per Produces above; `CHECK (amount_cents > 0)`, `CHECK (status IN ('PENDING','CLEARED','BOUNCED','VOID'))`, indexes on `(branch_id, status)`, `(customer_id, status)`, `(invoice_id)`, `(receipt_id)`; partial unique guard documented as application-level check (D1 has no partial unique index — enforce duplicate PENDING in service).

- [ ] **Step 4: Mirror the table in `apps/api/src/db/schema.ts` as `export const cheques` with identical column names.**

- [ ] **Step 5: Extend Zod in `packages/shared/src/schemas.ts`: add `chequeDetailSchema = z.object({ number: z.string().min(1).max(50), bankName: z.string().min(1).max(100), chequeDate: BUSINESS_DATE })`; add `"cheque"` to `splitPaySchema.method` + optional `cheque: chequeDetailSchema` refined (required iff method is cheque); add `"cheque"` to `customerReceiptSchema.method` + same optional/refined `cheque`.**

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-foundation.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Run typecheck and bundle check**

Run: `pnpm --filter goldos-api run build` then `pnpm --filter goldos-api run bundle:migrations`
Expected: PASS, new migration bundled.

- [ ] **Step 8: Commit**

```bash
git add apps/api/drizzle/0046_cheques.sql apps/api/src/db/schema.ts packages/shared/src/schemas.ts apps/api/src/services/cheques-foundation.integration.test.ts
git commit -m "feat: add cheques table and cheque validation"
```

### Task 2: POS sale with cheque legs (split-tender, ledger to 1200, no change)

**Files:**
- Modify: `apps/api/src/services/sales.ts`
- Test: `apps/api/src/services/cheques-sale.integration.test.ts`

**Interfaces:**
- Consumes: `cheques` table + `splitPaySchema` with `cheque` from Task 1; `resolvePayLegs`, `receiveSale`, `PAY_ACCOUNT`, `settlementStmt`, `moneyAccount`, `customerBalance`, `buildEntryStmts`, `businessDateFor` (existing).
- Produces: `receiveSale(db, input, actorId, { enforceShelfPrice, enforceCreditLimit })` accepts `payments: ({ method: "cheque", amountLkr, cheque: { number, bankName, chequeDate } })[]`; cheque legs post `Dr 1200 (party customer) / Cr 4000 + 2100` (never bank/1010 at sale time), insert one `cheques` row per cheque leg with `sale_payment_id`; throws `VALIDATION` when cheque lacks customer, lacks details, duplicates PENDING `(number, bank, amount)`, overpays with change, or exceeds amount-due via cheque.

- [ ] **Step 1: Write the failing test**

```ts
// cheques-sale.integration.test.ts: over real SQLite via migratedDb()
// - 60 cash + 40 cheque sale completes, invoice PAID, cheques row PENDING, 1200 leg = 40, bank legs = 0 for the cheque part
// - cheque without customerId rejects VALIDATION
// - cheque with tendered change rejects VALIDATION
// - duplicate PENDING (same number/bank/amount) rejects VALIDATION
it("takes 60 cash + 40 cheque as PAID with a PENDING cheque on 1200", async () => { /* assert invoice.status === 'PAID', cheques.status === 'PENDING', journal has Dr 1200 4000c not bank */ });
it("refuses a cheque with no customer", async () => { await expect(receiveSale(db, { ...noCustomer, payments: [{ method: "cheque", amountLkr: 100, cheque }]} , "u1", {})).rejects.toMatchObject({ code: "VALIDATION" }); });
it("refuses cash change when a cheque leg is present", async () => { /* tenderedLkr giving change + cheque leg → VALIDATION */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-sale.integration.test.ts`
Expected: FAIL (cheque method unhandled / posts to wrong account).

- [ ] **Step 3: Implement in `apps/api/src/services/sales.ts`: extend `PAY_ACCOUNT` with `cheque: "1200"`; extend `PayLeg` with `cheque?: { number, bankName, chequeDate }`; extend `resolvePayLegs` to attach cheque details and reject `bankAccountId` on cheque; in `receiveSale` require `customer` when any leg is cheque, require `cheque` object per cheque leg, enforce no-change rule (`tenderedCents` must equal `cashCents` exactly when cheque/credit present — reuse the existing tendered check, tightened), cap each cheque leg at total, check duplicate PENDING via `SELECT 1 FROM cheques WHERE cheque_number=? AND bank_name=? AND amount_cents=? AND status='PENDING'`; credit-limit check stays on `credit` legs only (cheque legs count as paid, so they do not consume the limit — per spec non-goal); journal maps cheque legs to 1200 with `partyType customer` (same as credit); after inserting `sales_payments` rows, insert matching `cheques` rows (`invoice_id`, `sale_payment_id`, `status 'PENDING'`).**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-sale.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run existing POS suite for regressions**

Run: `pnpm --filter goldos-api exec vitest run src/services/sales-pos.integration.test.ts src/services/accounts-suite.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/sales.ts apps/api/src/services/cheques-sale.integration.test.ts
git commit -m "feat: accept cheque legs at POS posting to receivables"
```

### Task 3: Cheque receipts, pending list, clear / bounce transitions

**Files:**
- Modify: `apps/api/src/services/receipts.ts`
- Create: `apps/api/src/services/cheques.ts` (list pending, clear, bounce)
- Test: `apps/api/src/services/cheques-lifecycle.integration.test.ts`

**Interfaces:**
- Consumes: `cheques` table, `customerReceiptSchema` with cheque (Task 1), `moneyAccount`, `buildEntryStmts`, `reverseEntry`, `businessDateFor`, `settlementStmt`, `customerBalance` (existing).
- Produces: `createReceipt(db, { method: "cheque", cheque: {...} })` posts `Dr 1200 (party customer) / Cr 1200 (party customer)`-neutral? No — posts `Dr 1200-cheque-hold / Cr 1200` equivalent: implemented as no net money move at receipt time beyond allocation (cheque receipt allocates FIFO like cash but creates a PENDING `cheques` row with `receipt_id`); `listPendingCheques(db, { branchId?, customerId? }): Promise<ChequeRow[]>`; `clearCheque(db, chequeId, { bankAccountId, actorId }): Promise<{ entryNo }>` posts `Dr <bank account code> / Cr 1200 (party)` on the sale branch + today, flips to CLEARED; `bounceCheque(db, chequeId, { reason, actorId }): Promise<void>` flips to BOUNCED + audit, leaves 1200 debt visible, re-runs `settlementStmt` on linked invoice; both enforce day-close lock via `buildEntryStmts` and throw `VALIDATION` on wrong status, `CONFLICT` when receipt void.

- [ ] **Step 1: Write the failing test**

```ts
it("collects a part-payment by cheque as PENDING then clears it to bank", async () => { /* 100 sale, 50 cash (PARTIAL) → 50 cheque receipt (PENDING, still PARTIAL per open-invoices) → clearCheque → bank leg exists, pending list empties */ });
it("bounced cheque reappears as owed and takes a cash replacement", async () => { /* 60+40 sale → bounceCheque(reason) → openInvoices shows 40 owed → createReceipt cash 40 → owed 0, audit has cheque.bounced */ });
it("refuses to clear on a closed day", async () => { /* close day, then clearCheque → TRANSITION_LOCKED/DAY_CLOSED */ });
it("refuses duplicate PENDING leaf", async () => { /* same number/bank/amount twice → VALIDATION */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-lifecycle.integration.test.ts`
Expected: FAIL (`clearCheque`/`bounceCheque` not defined, cheque receipt unhandled).

- [ ] **Step 3: Implement `createReceipt` cheque branch in `receipts.ts`: when `method === "cheque"`, require `cheque` details, resolve no bank account, post a memo-only holding entry (`Dr 1200 party / Cr 1200 party` is a no-op — instead post no money entry, only the receipt header + allocations + `cheques` row PENDING); allocations run FIFO identically to cash. Implement `apps/api/src/services/cheques.ts` with `listPendingCheques`, `clearCheque` (validate PENDING, require active bank account, `buildEntryStmts` with `Dr bankCode / Cr 1200 party` on the cheque's `branch_id` + today, update row to CLEARED + `cleared_on`, audit `cheque.cleared`), `bounceCheque` (validate PENDING, update to BOUNCED + reason + `bounced_on`, audit `cheque.bounced`, re-run `settlementStmt` for linked invoice; no money entry since the leg already sat in 1200).**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-lifecycle.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run receipts regression**

Run: `pnpm --filter goldos-api exec vitest run src/services/accounts-suite.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/receipts.ts apps/api/src/services/cheques.ts apps/api/src/services/cheques-lifecycle.integration.test.ts
git commit -m "feat: cheque receipts with clear and bounce lifecycle"
```

### Task 4: Settlement, void/return, reports with cheques kept distinct

**Files:**
- Modify: `apps/api/src/services/receipts.ts` (`settlementStmt`, `openInvoices` — only if needed; prefer no change)
- Modify: `apps/api/src/services/sales.ts` (`createReturn` original-method split, `getSale` cheque join)
- Test: `apps/api/src/services/cheques-settlement.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `TILL_PAID_SQL` (counts non-credit legs — cheque now counts as paid), `RECEIPTS_APPLIED_SQL`, `settlementStmt`, `createReturn`, `getSale`.
- Produces: No change to `settlementStmt` formula (PENDING cheque legs already count via `sales_payments method <> 'credit'`); `createReturn` with `refundMethod: "original"` treats cheque legs as 1200-owed (same branch as credit), never pays cash out for them; voiding a sale/receipt VOIDs linked PENDING cheques; `getSale` returns `cheques[]` per invoice; `salesBreakdown(groupBy: "payment")` surfaces `cheque` as its own key.

- [ ] **Step 1: Write the failing test**

```ts
it("PENDING cheque counts as paid; BOUNCED returns to owed", async () => { /* 60+40 sale → status PAID → bounce → status PARTIAL, paid_cents 60 */ });
it("voiding a sale voids its PENDING cheque", async () => { /* void path → cheques.status VOID, no orphan PENDING */ });
it("original-method return never cashes out a cheque leg", async () => { /* return on cheque-paid line → refund leg hits 1200, not 1000/bank */ });
it("payment breakdown shows cheque separately", async () => { /* salesBreakdown payment → row key 'cheque' with 4000c */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-settlement.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement: keep `TILL_PAID_SQL` as-is (cheque ≠ credit so it counts); in `createReturn` map `p.method === "cheque"` to the 1200-owed branch alongside credit; add void helper `voidPendingCheques(db, { invoiceId?, receiptId?, reason, actorId })` called from sale-void and `voidReceipt` paths (UPDATE cheques → VOID + audit, then `settlementStmt`); extend `getSale` to select linked `cheques` rows; verify `salesBreakdown` needs no change (it groups by `pay.method`, `cheque` appears naturally) — add the test only.**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-settlement.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/sales.ts apps/api/src/services/receipts.ts apps/api/src/services/cheques-settlement.integration.test.ts
git commit -m "feat: settlement and voids keep cheques distinct"
```

### Task 5: API routes for cheques

**Files:**
- Modify: `apps/api/src/routes/sales.ts`
- Modify: `apps/api/src/routes/receipts.ts`
- Create: `apps/api/src/routes/cheques.ts`
- Test: `apps/api/src/routes/cheques-routes.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 services; `requirePerm`, `serviceError`, `pagination` (existing).
- Produces: `GET /api/v1/cheques?status=PENDING&branchId=&customerId=` (accounts:view); `POST /api/v1/cheques/:id/clear { bankAccountId }` (accounts:manage); `POST /api/v1/cheques/:id/bounce { reason }` (accounts:manage); `POST /api/v1/sales/invoices` and `POST /api/v1/receipts` accept cheque payloads via shared schemas with zero route-logic change beyond validation passthrough.

- [ ] **Step 1: Write the failing test**

```ts
it("POST /sales/invoices with a cheque leg returns 201 and a PENDING cheque", async () => { /* app.request with cheque payload → 201, then GET /cheques?status=PENDING contains it */ });
it("POST /cheques/:id/bounce without reason returns 400", async () => { /* → 400 VALIDATION */ });
it("POST /cheques/:id/clear with inactive bank returns 409", async () => { /* → serviceError mapping */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/routes/cheques-routes.integration.test.ts`
Expected: FAIL (route 404).

- [ ] **Step 3: Implement `apps/api/src/routes/cheques.ts` (three handlers above, Zod `z.object({ bankAccountId: z.string().min(1) })` and `z.object({ reason: z.string().min(1).max(500) })`), mount it in the app router where `sales`/`receipts` mount (follow the existing `export const` + mount pattern in `src/index.ts` or `src/routes/index.ts` — check before editing); no logic beyond parse → service → `serviceError`.**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/routes/cheques-routes.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/cheques.ts apps/api/src/routes/sales.ts apps/api/src/routes/receipts.ts apps/api/src/routes/cheques-routes.integration.test.ts
git commit -m "feat: expose cheque pending/clear/bounce endpoints"
```

### Task 6: Web POS + receivables + invoice pages

**Files:**
- Modify: `apps/web/app/(app)/pos/page.tsx`
- Modify: `apps/web/app/(app)/accounts/receivables/page.tsx`
- Modify: `apps/web/app/(app)/sales/invoices/[id]/page.tsx`
- Modify: `apps/mobile/src/features/sales/PosScreen.tsx`

**Interfaces:**
- Consumes: Task 5 endpoints; existing `METHODS`, `PayRow`, `api()`, `Select`, `bankRows`, `customerCredit` patterns.
- Produces: `PayRow = { method, amountLkr, bankAccountId?, cheque?: { number, bankName, chequeDate } }`; `METHODS = ["cash","card","bank","cheque","credit","other"]`; cheque rows render number/bank/date inputs, require a customer, block change, cap at due; receivables page gains a pending-cheques section with Clear (bank picker) / Bounce (reason prompt) actions; invoice page shows cheque details + status pills; mobile POS mirrors the same method + fields.

- [ ] **Step 1: Write the failing check (no unit framework — static assertion)**

```bash
# fails before: no cheque in METHODS
grep -q '"cheque"' 'apps/web/app/(app)/pos/page.tsx' && echo HAS_CHEQUE || echo MISSING_CHEQUE
```

Expected: `MISSING_CHEQUE`.

- [ ] **Step 2: Implement web POS: add `"cheque"` to `METHODS`; extend `PayRow` with `cheque`; render number/bank/date inputs only for cheque rows; `needsCustomer` becomes true when cheque or credit present; `change` blocked (treat `canComplete` false) when cheque/credit present and tendered exceeds cash due; `payAll("cheque")` and split/auto-balance include cheque; POST body forwards `cheque` per row; surface server VALIDATION (no customer, duplicate leaf, overpay) via existing `toast.error`.**

- [ ] **Step 3: Implement receivables: fetch `GET /api/v1/cheques?status=PENDING&branchId=` alongside existing queries; render pending table (number, bank, date, amount, customer, sale) with Clear (bank-account select → `POST /cheques/:id/clear`) and Bounce (reason input → `POST /cheques/:id/bounce`) + `toast` + refetch; keep existing receipt create/void untouched.**

- [ ] **Step 4: Implement invoice page + mobile: invoice page renders `cheques[]` with status pills (PENDING amber / CLEARED green / BOUNCED red) and bank/date/number; mobile `PosScreen.tsx` gains the same `cheque` method + three fields + customer-required guard.**

- [ ] **Step 5: Verify**

Run: `grep -q '"cheque"' 'apps/web/app/(app)/pos/page.tsx' && echo HAS_CHEQUE`
Expected: `HAS_CHEQUE`. Then `pnpm --filter goldos-web run build` (or `lint` if build is heavy — use the repo's web check script).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add 'apps/web/app/(app)/pos/page.tsx' 'apps/web/app/(app)/accounts/receivables/page.tsx' 'apps/web/app/(app)/sales/invoices/[id]/page.tsx' apps/mobile/src/features/sales/PosScreen.tsx
git commit -m "feat: take cheques at till and manage pending cheques"
```

### Task 7: Statements, day-close, breakdown polish + acceptance sweep

**Files:**
- Modify: `apps/web/app/(app)/accounts/statements/page.tsx`, `apps/web/app/(app)/day-closing/page.tsx`, `apps/web/app/(app)/sales/reports/page.tsx` (only labels/columns)
- Test: `apps/api/src/services/cheques-acceptance.integration.test.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: statements/day-close/reports show a `cheque` column/leg distinct from bank/cash; acceptance test pins the spec's four checks (60+40 mixed sale → PENDING visible; clear → pending empties with bank leg only after clearance; bounce → 40 owed → 40 cash receipt → zero with full audit; 50-cash part-payment → PARTIAL → 50-cheque receipt → pending until cleared).

- [ ] **Step 1: Write the failing acceptance test**

```ts
it("spec acceptance: mixed cash+cheque, bounce+replace, part-pay by cheque", async () => {
  // 1. 100 sale: 60 cash + 40 cheque → PAID + PENDING listed
  // 2. clear → pending empties
  // 3. second sale same shape → bounce(reason) → PARTIAL with 40 owed → 40 cash receipt → PAID, audit rows for sale.complete + cheque.bounced + receipt.create, no deleted sales_payments row
  // 4. 100 sale 50 cash + 50 credit → PARTIAL → 50 cheque receipt → PENDING until cleared
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-acceptance.integration.test.ts`
Expected: FAIL (or asserts on missing cheque column data).

- [ ] **Step 3: Implement UI polish: add `cheque` to payment-method label maps and breakdown/day-close tables (display-only; no ledger change); confirm day-close cash/card cross-foot excludes PENDING cheques (they sit in 1200, not cash/bank — assert, don't move).**

- [ ] **Step 4: Run acceptance + full API suite**

Run: `pnpm --filter goldos-api exec vitest run src/services/cheques-acceptance.integration.test.ts`
Expected: PASS. Then `pnpm --filter goldos-api test`
Expected: PASS (entire suite green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/ apps/api/src/services/cheques-acceptance.integration.test.ts
git commit -m "feat: surface cheques in statements and day-close"
```
