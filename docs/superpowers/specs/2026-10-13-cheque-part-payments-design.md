# Cheque + Part-Payment for Customer Sales — Design

Date: 2026-10-13
Scope: customer purchases at the shop (sales / POS / receivables). Not supplier purchases.

## Intent and why

Today the till forces full payment in one go (cash / card / bank / credit / other, split across rows). In real life two cases happen daily:

1. Customer pays by cheque — shop hands over gold immediately and takes the cheque.
2. Customer pays half (or some amount) now and the rest later — no fixed return date agreed.

Currently cheques have no first-class type (staff use `bank` + a free-text note like "cheque no."), so there is no list of waiting cheques, no cleared / bounced state, and a bounced cheque has no clean way back to "owed". Part-payments work indirectly (unpaid remainder as a `credit` leg tied to a customer, collected later via customer receipts FIFO), but the till UX and the owed-balances screens do not speak in terms of "cheque" or "part-paid" — staff improvise.

Why now: cheques and half-payments are being turned away or tracked on paper, which loses traceability of who owes what.

Success: the till never forces full cash; every cheque is traceable to its sale and customer with cleared / bounced state; no bounced or half-paid sale disappears from what customers owe.

## Goals

- Accept `cheque` as a payment method at the POS (split-tender: e.g. half cash + half cheque in one sale).
- Capture all cheque details at the till: cheque number, bank name / branch, cheque date, amount (amount = the pay-row amount). Require a customer on any sale or receipt containing a cheque leg; if the customer has no record, create one on the spot (current credit-leg rule, extended to cheques).
- Hand over gold immediately on cheque / partial payment (no hold-for-clearance flow).
- Track cheque lifecycle: `PENDING` (taken, waiting) → `CLEARED` or `BOUNCED`. Bounced flips the amount back to owed against the same customer + invoice so it reappears in receivables; staff then record the replacement payment (cash / bank / card / new cheque) normally.
- Part-payments: take whatever is paid now (any mix of cash / card / bank / cheque), leave the rest as owed with no due date. Collect later through the existing customer-receipts flow, which must also accept cheques.
- Owed-balances screens (receivables, customer open invoices, statements) show cheque legs distinctly (pending / cleared / bounced) and keep bounced + unpaid-part amounts visible until settled.
- Day-closing / sales reports break out cheques separately from bank/cash (cheques in hand are not cleared bank money).
- Auditability: who took / cleared / marked-bounced each cheque, with timestamps.

## Non-goals

- Supplier-side cheques (purchase invoices stay bank-only in this change).
- Old-gold, repairs, custom-order advance flows (they keep current cash/bank/card methods).
- Post-dated-cheque scheduling / reminders / auto-presenting on a date.
- Cheque printing, bank-file export, or automatic bank-reconciliation matching.
- Due dates, payment plans, interest, or late fees for part-payments (balances stay open with no promised date, per shop practice).
- Credit-limit policy change (existing limit checks on credit legs stay as-is).

## Anti-goals (what would make this a failure even if it technically works)

- A bounced cheque silently staying "paid" — the debt must reappear.
- A cheque recorded as cleared bank money before it clears (inflates bank position).
- Free-text cheque numbers that can't be listed, searched, or tied to a customer.
- Deleting or editing a payment row to "fix" a bounce (violates append-only ledger rule).
- A walk-in cheque or part-payment with no customer link that becomes unchasable.

## Constraints (existing system — builder must respect)

- Engine: Cloudflare D1 (SQLite). Migrations: new sequential SQL file in `apps/api/drizzle/`; never edit an applied migration. Mirror in `apps/api/src/db/schema.ts`.
- API: Hono in `apps/api/src/routes/` + `services/`; validation via Zod in `packages/shared/src/schemas.ts`. Current sale creation (`services/sales.ts` `receiveSale`) requires Σ payments == total; underpayment is expressed as a `credit` leg needing customer + limit check. Receipts (`services/receipts.ts`) allocate FIFO oldest-first; `paid_cents/status` recomputed by `settlementStmt()`, not trusted.
- Ledger: every sale / receipt posts journal entries atomically (`db.batch`); corrections are VOID / REVERSE with reason + user + timestamp, never DELETE/UPDATE of money rows. Journal `entry_date` is shop-local `YYYY-MM-DD` honoring `business_tz_offset_minutes`; day-close lock (`buildEntryStmts` + `trg_journal_day_lock`) blocks postings on CLOSED days. Every entry names a branch. Every write batches its `audit_logs` row. No hard deletes of business records.
- Business-rules doc says payment methods are configuration (`settings`), but methods are currently hard-coded unions (`cash/card/bank/credit/other` in sales, `cash/bank/card` in receipts). Builder: add `cheque` to the unions and, if trivial, expose it via settings; do not redesign the settings system here.
- UI: Next.js POS at `apps/web/app/(app)/pos/page.tsx` (`METHODS`, `PayRow`) + mobile mirror `apps/mobile/src/features/sales/PosScreen.tsx`; receivables at `apps/web/app/(app)/accounts/receivables/page.tsx`; statements, day-closing, sales reports/invoices. Keep split-tender + tendered/change behavior.

## The parts the shop decided (builder: treat as fixed)

1. Scope is customer sales only.
2. Gold is handed over immediately for cheques and part-payments.
3. Bounce handling is manual: inform the customer, mark bounced in system, take replacement payment.
4. Cheque capture = number + bank + cheque date, saved with the sale.
5. Half-cash + half-cheque in one sale is a normal case; the cheque leg follows the same pending → cleared/bounced path.
6. No return date is agreed for part-payments; balances stay open.
7. New customers are created on the spot when a cheque or part-payment needs one.

## What's left to the builder (your calls — marked as such below)

- Exact storage shape. Suggested (builder may adjust): new `cheques` table (`id, branch_id, customer_id, invoice_id NULLABLE for POS leg vs receipt_id NULLABLE for collection leg, sale_payment_id NULLABLE, receipt_id NULLABLE, cheque_number, bank_name, cheque_date TEXT YYYY-MM-DD, amount_cents, status PENDING/CLEARED/BOUNCED, cleared_on NULL, bounced_on NULL, replacement_ref NULL, created_at, created_by`) with unique guard against duplicate `(cheque_number, bank_name, amount_cents)` reuse while PENDING, OR columns directly on `sales_payments` + `customer_receipts` — your call, but one query must list all pending cheques by customer/branch/date. [builder call]
- Ledger mapping for a PENDING cheque. Do NOT post it as cleared bank (1010 / named bank account). Suggested: post the cheque leg to Customer Receivables (1200) at sale time like a credit leg, and move it to bank only on CLEARED via a receipt-style entry; on BOUNCED leave it in 1200 so the debt is already visible. If the chart needs a "cheques in hand" clearing account, propose the lowest-touch option consistent with the flat chart. [builder call]
- Bounce mechanics honoring append-only: suggested — BOUNCED is a status flip on the `cheques` row plus a reversal-style journal entry only if the original leg posted anything resembling cash; if the leg already sat in 1200, no money entry is needed, just status + audit + receivables visibility. Never delete the `sales_payments` row. Replacement payment is a new receipt allocation, not an edit. [builder call]
- Validation details: cheque requires customer_id (create-on-spot in UI), cheque_number non-empty, bank_name non-empty, cheque_date valid (allow past/present; decide whether future-dated is warn or block — suggest warn only since PDCs exist but are out of scope). Amount > 0 and split-tender sum rule unchanged. [builder call]
- Permissions: reuse existing `sales:create`, `receipts:create/void` (or local equivalents); decide whether marking CLEARED/BOUNCED needs manager/accountant approval — suggest cashier can mark CLEARED with audit, BOUNCED needs reason text; approval gate optional. [builder call]
- UI shape: extend `METHODS` with `cheque`, extend `PayRow` with number/bank/date fields shown only for cheque rows; receivables gets a pending-cheques section with clear/bounce actions + reason prompt; reports/statements/day-close show a cheque column. Exact layout your call. [builder call]
- PENDING counting [builder call, confirm below]: a PENDING cheque counts as paid for invoice `paid_cents` / `status` (so a fully cheque-paid sale reads PAID) and is excluded from the open-owed total; it stays visible in a separate pending-cheques list. BOUNCED removes it from paid and returns it to owed. CLEARED is display + bank-leg movement only, no change to paid totals.
- Void / return with cheques [builder call]: voiding a sale (or voiding a cheque-bearing receipt) cancels its linked PENDING cheques (status → VOID with reason, audit-logged) and reverses any journal legs per the normal void path; a sale with a CLEARED cheque voids like a bank-paid sale; a sale with a PENDING cheque warns before void. Returns follow the same refund-method logic, with cheque legs refunded as cash/bank/credit per existing `refundMethod` options (no cheque-refund).
- Tendered / change [builder call]: no cash change may be given when a cheque or credit leg is present; cheque amount is capped at amount-due (no overpay-by-cheque). Cash/card overpay with change follows existing behavior only when no cheque/credit leg exists.
- Clear / bounce posting identity [builder call]: CLEARED/BOUNCED actions post (if a money entry is needed) under the original sale's branch with the current shop-local business date (`business_tz_offset_minutes`), enforcing the day-close lock like any other posting; cross-branch clearing is not allowed (clear from the owning branch).
- Bounced follow-up [builder call]: a BOUNCED amount sits as open debt indefinitely, exactly like a part-payment remainder, with no due date. Replacement is any new receipt (cash/bank/card/cheque); the receipt may optionally reference the bounced cheque id for audit (`replacement_ref`), but is not required. The same physical cheque is never re-activated — a re-presented cheque is recorded as a new cheque row.
- History [builder call]: existing `bank`+note rows stay frozen as-is; no backfill/classifier. The pending-cheques list starts from go-live.

## Acceptance checks

- Sell LKR 100 item: LKR 60 cash + LKR 40 cheque (new customer, all cheque fields) → sale completes, gold moves to SOLD, customer owes LKR 0 in the "paid" sense but LKR 40 sits as pending cheque; receivables shows it.
- Mark that cheque CLEARED → pending list empties, bank-side reflects only after clearance (per chosen mapping).
- Second sale, same shape, mark BOUNCED with reason → LKR 40 reappears as owed on that customer/invoice; record LKR 40 cash receipt → owed returns to zero; full audit trail present; no payment row deleted.
- Part-payment: LKR 100 sale, LKR 50 cash only (remainder as credit leg) → invoice PARTIAL, receivables shows LKR 50 open; pay LKR 50 by cheque later → pending cheque visible until cleared.
