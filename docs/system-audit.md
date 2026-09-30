# GoldOS Production-Readiness Audit

Date: 2026-09-28. Method: static traces of every service + route, live end-to-end runs of all 7 workflows against local D1 (supplier → sale → old gold → melt → manufacturing → day close → monthly), full test suite, `tsc` on all three packages, `next build`, SQLite `integrity_check` + `foreign_key_check`. Nothing here is claimed from reading alone — every bug below was reproduced live unless marked otherwise.

## 1. Workflows tested end to end (all passing after fixes)

- **W1 Jewellery Purchase**: supplier → order → receive. Verified: charges folded into item cost (400000 + 10000), product IN_STOCK with barcode, supplier party tags on both 1100/2000 legs, `PURCHASE` gold row (4763mg = round(5200×916/1000)), journal linked, audit row.
- **W2 Jewellery Sale**: POS as cashier → PAID invoice; product SOLD; `SALE` gold row matching purchase fine exactly; journal DR1000/CR4000 + DR5000/CR1100 with COGS at book cost (410000, not sale price); audit row.
- **W3 Old Gold**: intake → test → valuation (override correctly demanded reason, then went PENDING under the new approval gate; approved by second user; redeemed) → purchase. Verified value math (3800mg×916 → 3481mg), remainder to customer payable (CR1200 tagged).
- **W4 Melting**: release → batch → add → lock → melt (loss 92mg/1.25% auto-approved under threshold) → approve. Verified INPUT/OUTPUT/LOSS rows and book-cost loss posting.
- **W5 Manufacturing**: order → allocate → produce (balance gate refused unbalanced input; 7.59% loss went PENDING → approved → redeemed) → QC → finish. Verified JW- barcode minted with cost, INPUT/OUTPUT/LOSS rows conserving (7236 = 6687 + 549).
- **W6 Daily Closing**: preview (18/18 checks) → close → reopen (second person) → re-close. All gates exercised including difference-reason requirement.
- **W7 Monthly Closing**: aggregation correct across sales/purchases/gold/expenses/profit/cashflow/receivables/payables/inventory; snapshot freeze + CSV with preamble verified.
- **Reconciliation**: 18/18 checks green after fixes (was 15/18 on arrival).

## 2. Bugs found and fixed (this audit)

1. **Old-gold purchases wrote no live gold rows.** `purchaseItem` posted to legacy `gold_movements` only. Every purchased gram failed `gold_stock_consistency` and the `OLD_GOLD_PURCHASE` cross-foot until melted. Fix: write `OLD_GOLD_PURCHASE` rows (`customer:` → `branch:`) in the same batch; migration `0029` backfills history idempotently. Verified live.
2. **Melt INPUT rows broke directional accounting.** Source `old-gold:<id>` contributes zero outflow, so every melt overstated ledger gold by its input weight (proven by invariant analysis + live experiment). Fix: branch-sourced INPUT; migration `0030` aligns history. **Half of this fix was wrong and reverted**: branch-sourcing the LOSS row broke consistency by exactly the loss (live-measured −92mg), because melt loss sits in neither held side. LOSS rows stay `melting:`-sourced, same as manufacturing LOSS. The experiment, not the theory, decided it.
3. **`party_ledgers` check failed on legitimate credits.** Any net-credit customer balance (old-gold remainders — the system's own designed posting) failed the check and, via the hard close gate, permanently blocked day-close. Fix: only *unexplained* credits fail (total minus `old_gold_purchase`/`sale_return` postings). Verified: previously failing branch now passes.
4. **Branch-scoped monthly gold always returned zeros.** Bind order `[from, to, slug]` vs placeholder order (slug first) in `goldSum`. Fixed; verified live (in 81796 / out 42491).
5. **Direct product creation 500'd.** `createProductSchema` lacked `branchId`, so Zod stripped it and the insert failed. One-line schema fix; also cleared all 4 pre-existing `tsc` errors repo-wide (all three packages now typecheck clean).
6. **Costless products sold with COGS 0.** NULL-cost products posted zero COGS, silently overstating margin. Fix: POS refuses NULL-cost products (`VALIDATION`); explicit zero remains the shop's assertion. (Related: direct intake writes an `OPENING` gold row now so uncosted metal doesn't break consistency; still no financial opening entry — see §4.)
7. **Web client discarded 202 PENDING payloads.** `api()` threw plain `Error`, losing approvalId/terms and making the retry flow uncompletable from UI. Fix: `PendingApprovalError` + extended `ApiResponse` error fields.
8. **Gross-based unclassified gate was irreversible.** Reversals reuse the original ref, so reversing a manual cash error *deepened* the hole — the day could never close. Fix: gate on per-ref net (`unclassifiedNet`), gross lines stay visible; same rule in the monthly guard.
9. **Re-close crashed with raw 500.** Reopening then re-closing hit the unique index (pre-check only looked for `CLOSED`). Fix: re-close UPDATEs the reopened row, archiving the prior snapshot in audit `prev_json`; reopen trail untouched. Verified live.
10. **No CSRF defense on mutations.** Cookie is `SameSite=None` with no token/Origin check; multipart upload endpoints were reachable by forged cross-site forms. Fix: `middleware/csrf.ts` — non-GET with a foreign Origin/Referer → 403; absent headers (curl/native) unaffected. Verified live (evil 403, legit 200).
11. **Monthly cash excluded reversals; balances/day-close include them.** POSTED-only cashflow showed a phantom +200 inflow from a lone mirror entry. Fix: cash section counts all statuses like every other cash reader. (Revenue/COGS sections intentionally unchanged.)
12. **Monthly page showed infinite "Loading" on query failure.** Added error branch.

## 3. Completed modules

Purchases (orders/receive/direct/void), POS sales + returns/exchanges, old gold (intake/test/value/purchase/release/convert), melting (batches/lock/melt/approve/void), manufacturing (orders/materials/produce/QC/finish/void), inventory (movements, counts + adjustments, transfers with lines, discrepancy reports, branch overview), repairs, custom orders, expenses + approvals, cash/bank/transfers/settlements, day closing + reopen, monthly reporting + snapshots + CSV/xlsx, approval engine + center, audit log + audit UI. ~~UI gaps (API-complete, no screen yet): counts, transfers, discrepancies, branch overview, repairs, custom orders.~~ **Resolved 2026-09-30:** every module has a screen (`/repairs`, `/custom-orders`, `/branches/overview` were the last three).

## 4. Known limitations (not changed; deliberate)

- ~~No financial opening-balance flow for stock.~~ **Resolved 2026-09-29:** direct intake posts DR 1100 / CR 3100; `POST /accounts/opening-stock/backfill` covers earlier pieces.
- **No cash-correction flow.** Genuine till corrections can only be manual journals (now visible, net-gated) — a typed correction flow with its own breakdown line is recommended (§7).
- **Receivables total nets credits.** Net-credit customers fold into one figure; detail exists in outstanding/aging lists. Consider gross debit/credit split later.
- **Valuation refuses unrated purities** (correct) and the nearest-purity fallback self-matches when the tested purity exists but is unrated — shops must post rates for every active purity (seed lacks 24K/21K).
- ~~**`idempotency_keys` table exists but is unwired.**~~ **Resolved 2026-09-30:** `middleware/idempotency.ts` honours `Idempotency-Key` on every `/api/v1` mutation (session-scoped, body-hashed, 24h replay, 5xx never stored); the web client sends one per mutation and retries a dropped request once with the same key.
- ~~**Session "idle" expiry is absolute.**~~ **Resolved 2026-09-30:** `requireAuth` slides the 12h idle deadline (written at most every 5 min), capped at 7d; the cookie lives to the cap and the server enforces idle.
- **Seed data is hand-written and non-conserving** (melt output exceeded input; manual cash adjustments with empty memos). Local scratch only; production seeds must go through service flows.

## 5. Remaining risks

- **Rate limiting:** ~~none~~ **login throttling landed 2026-09-30** (`services/throttle.ts`, migration `0037`): 5 failures/15 min locks the account, 30/15 min locks the IP, both for 15 min, answered 429 + `Retry-After`. Unknown emails now pay one scrypt run (timing oracle closed). General per-IP API caps still belong in Cloudflare rate-limiting rules.
- ~~**Counter races.**~~ **Resolved 2026-09-30:** every document counter allocates through `services/counters.ts` (atomic `UPDATE … RETURNING`, steps past taken numbers). Gaps on failed writes are accepted, as they already were for JE/EXP/RCPT.
- **`uniqueCode` barcode race.** Check-then-insert over a 32^6 space: a collision needs two simultaneous requests drawing the same code (~1e-9). Accepted.
- **Cross-month reversal asymmetry.** A reversal landing in a later month than its error nets in day-close (same-day scope) but appears solo in that month's snapshot window. Accepted: the month's books genuinely contain the mirror.
- **NIC/phone PII** is visible to all `masters:view` holders (broad role set). Consider field-level redaction later.
- **`seed.ts` builds SQL by string interpolation** (offline script, admin-supplied values) — keep it offline; never feed untrusted input.

## 6. Database issues (all clear or fixed)

- `integrity_check: ok`; `foreign_key_check`: zero violations (before and after).
- All queries parameterized; table/column identifiers are static or whitelisted (`categories|purities` union; per-route literals). No SQL injection surface found.
- FKs are declared in every migration and D1 enforces them (the product-creation 500 was an FK/NULL failure surfacing correctly, now fixed at the schema layer).
- Migrations `0029` (old-gold backfill, idempotent `NOT EXISTS`) and `0030` (melt INPUT source alignment, scoped to `old-gold:` sources only) are additive; no applied migration was edited.

## 7. Security issues

- Fixed: CSRF on mutations (§2.10). All routes already carry `requireAuth` + per-action `requirePerm` (spot-checked: RBAC negative test 403s live; permission matrix unchanged at 53).
- Verified: HttpOnly+Secure+SameSite=None cookies; 12h+7d expiry enforced with inactive-user rejection; scrypt + timing-safe compare; single-use 15-min reset tokens stored hashed; uploads allowlisted to jpeg/png/webp ≤5MB with server-set extensions; `password_hash` never selected except login/change; no `dangerouslySetInnerHTML`; generic login errors.
- Open (operational): rate limiting (above); `WEB_ORIGIN` must include the deployed Pages domain or the CSRF guard will 403 the web app — deployment checklist item.

## 8. Performance issues

- No indexes missing for the hot paths (approvals, ledger, movements all indexed by status/ref/branch); N+1 name lookups in monthly receivables/payables loops (one query per party — fine at shop scale, revisit past ~10k parties).
- Recharts dashboard fires 12 parallel monthly queries (cached 5 min) — acceptable; no pagination on trend range by design.
- `next build` clean; `/approvals` renders server-side without errors.

## 9. Recommended next steps (in order)

1. Typed cash-correction flow (own ref_entity + breakdown line) so till corrections don't live in manual journals.
2. Financial opening-balance intake (journal + gold + cost in one batch) to retire the direct-create gap fully.
3. Wire `idempotency_keys` into money/gold writes (safe retries, mobile/POS flakiness).
4. Login throttling + Cloudflare rate-limit rules; decide idle-vs-absolute sessions and update code or docs.
5. UI for the six API-complete modules (counts, transfers, discrepancies, branch overview, repairs, custom orders).
6. Gross debit/credit split on receivables/payables totals; rates required for all active purities (seed them).
7. Re-run this audit's live checklist on a fresh database before any AI-feature work (current scratch DB carries audit test rows; day left REOPENED intentionally).

## 10. Follow-up pass (2026-09-30)

Bugs found and fixed, each with a real-SQLite regression test (`race-guards`, `transit-gold`, `hardening` integration suites; 367 tests green, `tsc` clean in all packages, `next build` clean):

1. **In-transit transfers failed the day-close gate for both branches.** Dispatch moves gold to the receiver in the ledger, but held stock counted the `TRANSFER_PENDING` piece at the sender, so branch-scoped `gold_stock_consistency` was off by the piece's fine weight in both branches until receipt. Held stock now attributes an in-transit piece to its receiver. Proven red without the fix.
2. **Transfer recall never reversed the gold ledger.** The piece went back on the sender's shelf while the ledger kept its gold at the receiver permanently. `recallLines` now posts the reverse `TRANSFER` (`ref_entity = 'transfer_recall'`); migration `0038` backfills history by mirroring each recalled line's dispatch row; `reconcileTransfer` checks for it.
3. **Repair collection could post revenue twice** (the journal was in the same batch as a status-guarded UPDATE that could match nothing). New `services/guard.ts` (`staleGuard` + `batchOrConflict`) aborts the whole batch when the guarded UPDATE lost the race → 409. Applied to every repair transition and every custom-order state change.
4. **Concurrent custom-order advances lost money in the order row** (absolute `advance_cents = ?` overwrite while both journals posted). Now a relative, guarded update.
5. **One old-gold item / melt lot could be earmarked to two live orders**, and any batch error was reported as "Already earmarked". Now an explicit cross-order check naming the holding order; earmarks on cancelled orders are released.
6. **Repairs and custom orders ignored `search` and the branch-member rule.** Both lists now search (number, item/design, customer name/phone), return customer and branch names, and are scoped to the caller's branches; every `/:id` action checks membership.
7. Web client: non-JSON error replies no longer throw a JSON parse error; `formApi` keeps the error code; `downloadCsv` surfaces the API's message. Branch-overview CSV permission is checked before the report is computed.

Still open (unchanged): typed cash-correction flow (§9.1), gross debit/credit split on receivables (§4), post-production cancel needs an approver picker endpoint (UI takes a user id), shop-lot earmarks do not check remaining lot weight.