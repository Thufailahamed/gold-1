# GoldOS API

Base: `/api/v1`. Envelope: `{ success: true, data }` or
`{ success: false, error: { code, message } }`.
Codes: `UNAUTHORIZED, FORBIDDEN, VALIDATION, NOT_FOUND, CONFLICT, INTERNAL`.
Auth: `session` httpOnly Secure cookie; 401 when missing/expired/inactive.

Lists accept `?search=&page=&limit=&sort=` and return `{ rows, total }`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | /health | — | liveness |
| POST | /auth/login | — | Zod-validated, sets cookie, audits |
| POST | /auth/logout | auth | destroys session, audits |
| GET | /auth/me | auth | user + permissions + branchIds |
| POST | /auth/change-password | auth | verifies current; destroys all sessions; relogin |
| POST | /auth/reset-request | users:edit | returns single-use 15-min token once; deliver securely |
| POST | /auth/reset-confirm | — | token + new password; marks used; destroys sessions |
| POST | /users | users:create | role + branchIds[] + audit in one batch |
| GET | /users | users:view | paginated |
| GET | /users/:id | users:view | detail with roles + branchIds |
| PATCH | /users/:id | users:edit | name/branches; role change needs users:approve |
| PATCH | /users/:id/deactivate | users:edit | requires reason; never self |
| PATCH | /users/:id/activate | users:edit | requires reason; never self |
| GET | /roles | users:view | roles with permission lists |
| POST | /branches | branches:create | code unique |
| GET | /branches | branches:view | scoped to member branches unless branches:manage |
| PATCH | /branches/:id | branches:edit | optional reason audited |
| GET | /settings/:key | settings:view | |
| PUT | /settings/:key | settings:edit (settings:manage for branch.* keys) | type-checked, audited |
| GET | /audit | audit:view | filterable by entity, entityId, userId; paginated |
| POST | /masters/categories | masters:create | name + code unique |
| GET | /masters/categories | masters:view | paginated |
| PATCH | /masters/categories/:id/deactivate | masters:cancel | requires reason |
| POST | /masters/purities | masters:create | karat unique, 0 < purity <= 1 |
| GET | /masters/purities | masters:view | paginated |
| PATCH | /masters/purities/:id/deactivate | masters:cancel | requires reason |
| POST | /gold-rates | masters:create | immutable; UNIQUE(purity, effective_from) |
| GET | /gold-rates/current | masters:view | latest rate per purity |
| GET | /gold-rates | masters:view | history, filterable by karat; paginated |
| POST | /suppliers | masters:create | branch-scoped, NIC unique |
| GET | /suppliers | masters:view | branch-scoped unless branches:manage; paginated |
| PATCH | /suppliers/:id | masters:edit | field updates; optional reason |
| PATCH | /suppliers/:id/status | masters:cancel | isActive + reason required |
| POST | /customers | masters:create | branch-scoped, NIC unique |
| GET | /customers | masters:view | branch-scoped unless branches:manage; paginated |
| PATCH | /customers/:id | masters:edit | field updates; optional reason |
| PATCH | /customers/:id/status | masters:cancel | isActive + reason required |
| POST | /products | products:create | auto JW- barcode + SKU; grams/LKR in, mg/cents stored |
| GET | /products | products:view | filters: status, categoryId, purityId, branchId, min/max grams, min/max LKR; paginated |
| GET | /products/:id | products:view | detail + live price in cents (or no_rate) |
| PATCH | /products/:id | products:edit | refs/charges/cost/price/location/notes; weights locked |
| GET | /products/barcode/:code | products:view | scan lookup PRD-/JW-, case-insensitive |
| GET | /products/:id/label | products:view | Code128 SVG label, image/svg+xml |
| POST | /products/:id/images | products:edit | multipart ≤5MB jpeg/png/webp, ≤10 per product → R2 |
| GET | /products/:id/images/:img | products:view | streams image from R2 |
| PATCH | /products/:id/void | products:cancel | reason required; writes VOID movement; never deletes |
| POST | /masters/subcategories | masters:create | requires categoryId |
| GET | /masters/subcategories | masters:view | filterable by categoryId |
| POST | /masters/designs, /product-types, /metal-types, /stone-types | masters:create | name + code unique |
| GET | /masters/designs, /product-types, /metal-types, /stone-types | masters:view | paginated |
| POST | /inventory/movements | products:edit | IN_STOCK→TRANSFER_PENDING/RETURNED/LOST/VOID; locked → 409 |
| GET | /inventory/movements | products:view | filterable by productId, branchId, type |
| GET | /inventory/stock?groupBy= | products:view | branch/purity/product totals (mg + value at current rates) |
| GET | /bank-accounts | accounts:view | each with its ledger balance; optional ?branchId= |
| POST | /bank-accounts | accounts:manage | allocates the account code and creates the ledger account and the registration together |
| PATCH | /bank-accounts/:id | accounts:manage | rename, deactivate |
| POST | /bank-accounts/:id/opening | accounts:manage | {amountCents, reason, entryDate?}; DR bank / CR 3100; 409 if already opened |
| POST | /bank-accounts/:id/reconcile | accounts:view | {statementDate, statementBalanceCents, note?}; records the statement and returns ledger balance, difference and the uncleared list |
| POST | /cash/deposits | accounts:manage | {branchId, bankAccountId, amountCents, note?, entryDate?}; DR bank / CR 1000 |
| POST | /cash/withdrawals | accounts:manage | same shape; DR 1000 / CR bank |
| GET | /cash/transfers | accounts:view | ?status&branchId |
| POST | /cash/transfers | accounts:manage | dispatch; {fromBranchId, toBranchId, amountCents, sentOn?, reason} |
| POST | /cash/transfers/:id/receive | accounts:manage | {receivedOn?, note?} |
| GET | /card-settlements | accounts:view | paginated; ?bankAccountId= |
| POST | /card-settlements | accounts:manage | {bankAccountId, grossCents, feeCents?, settledOn?, acquirerRef?, note?}; DR bank net / CR 1020 gross / CR 6060 fee |
| GET | /expense-categories | accounts:view | each with its account and lifetime spend |
| POST | /expense-categories | accounts:manage | allocates the account code (6090-6199) and creates the ledger account |
| PATCH | /expense-categories/:id/status | accounts:manage | refuses when the category has expenses |
| GET | /expenses | accounts:view | ?from&to&branchId&categoryId&status&page&limit |
| POST | /expenses | accounts:manage | posts immediately, or lands PENDING_APPROVAL above the approval threshold |
| GET | /expenses/:id | accounts:view | with category, entry and approval trail |
| POST | /expenses/:id/approve | accounts:manage | {reason?}; the approver must not be the requester; a receipt is required above the receipt threshold |
| POST | /expenses/:id/reject | accounts:manage | {reason} required; the expense is kept, never deleted |
| POST | /expenses/:id/receipt | accounts:manage | multipart, jpeg/png/webp, 5MB |
| GET | /expenses/:id/receipt | accounts:view | streams the receipt |
| GET | /expenses/reports/summary | accounts:view | by category; registered BEFORE /expenses/:id |
| GET | /day-closings | accounts:view | ?branchId&from&to&page&limit |
| GET | /day-closings/preview | accounts:view | ?branchId&date; the rendered screen plus each check's state. Registered BEFORE /day-closings/:id |
| GET | /day-closings/:id | accounts:view | the frozen report plus the re-open trail |
| GET | /day-closings/:id/report | accounts:view | the frozen report, for printing or export |
| POST | /day-closings | accounts:manage | {branchId, date, actualCents, differenceReason?}; 409 if a check fails, 409 on unrecognised cash, 409 if already closed, 400 on a difference with no reason |
| POST | /day-closings/:id/reopen | accounts:manage | {reason, approvedBy}; the approver must hold accounts:manage and be neither the requester nor whoever closed the day |
| GET | /accounts | accounts:view | 24 accounts + balance_cents, entry_count, is_system, is_editable; optional ?branchId= |
| POST | /accounts | accounts:manage | create account; code /\d{4}/, unique, is_system=0 |
| PATCH | /accounts/:code | accounts:manage | rename/describe; refuses system accounts and any account with journal lines |
| PATCH | /accounts/:code/status | accounts:manage | deactivate/reactivate; same refusals |
| POST | /accounts/adjustments | accounts:manage | balanced two-leg entry + reason + **branchId (required)**; cents; optional entryDate; returns id, entryId, entryNo |
| GET | /accounts/journal | accounts:view | ?from&to&branchId&accountCode&sourceModule&refEntity&page&limit |
| GET | /accounts/journal/:id | accounts:view | one entry with ordered lines |
| POST | /accounts/journal/reverse | accounts:manage | {entryId, reason, entryDate?}; mirror + reverses_entry_id, original becomes REVERSED |
| GET | /accounts/trial-balance | accounts:view | ?date&branchId; as of a date |
| GET | /accounts/reconciliation | accounts:view | ?date&branchId; 15 cross-foot checks, passed + per-check expected/actual/difference/detail. A failing check is a 200 with passed:false, not an error |
| GET | /accounts/:code/statement | accounts:view | ?from&to&branchId; running balance from an opening |
| GET | /customers/:id | masters:view | profile incl. code + notes |
| GET | /customers/:id/ledger | masters:view | opening + journal lines + balance |
| GET | /suppliers/:id | masters:view | profile incl. code + notes |
| GET | /suppliers/:id/ledger | masters:view | opening + journal lines + balance |
| POST | /purchases/orders | purchases:create | draft, no postings |
| GET | /purchases/orders | purchases:view | filters supplier, branch, status |
| GET | /purchases/orders/:id | purchases:view | order + items |
| PATCH | /purchases/orders/:id/cancel | purchases:cancel | DRAFT/SENT only + reason |
| POST | /purchases/orders/:id/receive | purchases:create | full atomic 7-step flow → invoice |
| POST | /purchases/invoices | purchases:create | direct intake, same atomic flow |
| GET | /purchases/invoices | purchases:view | filters supplier, branch, status, date range |
| GET | /purchases/invoices/:id | purchases:view | items + payments + journal |
| POST | /purchases/invoices/:id/payments | purchases:edit | {amountLkr, bankAccountId}; amount ≤ outstanding. `bankAccountId` replaces the old `method: cash\|bank` — a payment names the account it left, so a shop with two banks can reconcile them separately |
| PATCH | /purchases/invoices/:id/void | purchases:cancel | IN_STOCK items only + reversal + reason |
| GET | /purchases/reports/summary | purchases:view | ?period=today\|month\|all |
| GET | /purchases/reports/breakdown | purchases:view | ?groupBy=supplier\|purity\|category |
| POST | /sales/invoices | sales:create | atomic 14-step flow; split payments; approval over limit |
| GET | /sales/invoices | sales:view | filters customer, branch, status, date range |
| GET | /sales/invoices/:id | sales:view | items + payments + journal + returns |
| POST | /sales/returns | sales:cancel | full/partial/exchange + approval over threshold |
| PATCH | /sales/returns/:id/link | sales:edit | link exchange sale |
| GET | /sales/returns | sales:view | filterable by invoice |
| GET | /sales/reports/summary | sales:view | ?period=today\|month\|all |
| GET | /sales/reports/breakdown | sales:view | ?groupBy=category\|purity\|branch\|salesperson\|payment\|product |
| POST | /oldgold/items | oldgold:create | intake → RECEIVED + OG number |
| GET | /oldgold/items | oldgold:view | filters status, purity, branch, customer, date range |
| GET | /oldgold/items/barcode/:code | oldgold:view | OG- scan lookup |
| GET | /oldgold/items/:id | oldgold:view | full lineage + journal + gold + tests |
| POST | /oldgold/items/:id/tests | oldgold:edit | disagreement needs oldgold:approve approver |
| POST | /oldgold/items/:id/value | oldgold:edit | buy % + deductions + negotiated (reason on overrides) |
| POST | /oldgold/items/:id/purchase | oldgold:edit | atomic 5-ledger batch; remainder → customer payable |
| POST | /oldgold/items/:id/release | oldgold:edit | PURCHASED → AVAILABLE |
| POST | /oldgold/items/:id/convert | oldgold:edit + products:create | creates JW- product, lineage both ways |
| POST | /oldgold/items/:id/files | oldgold:edit | images ≤5MB / docs ≤10MB to R2 |
| GET | /oldgold/items/:id/files/:file | oldgold:view | streams from R2 |
| PATCH | /oldgold/items/:id/void | oldgold:cancel | pre-purchase only + reason |
| GET | /oldgold/reports/summary | oldgold:view | ?period=today\|month\|all |
| GET | /oldgold/reports/breakdown | oldgold:view | ?groupBy=purity\|customer\|branch |
| GET | /oldgold/reports/pending | oldgold:view | PURCHASED/AVAILABLE unmelted |
| GET | /oldgold/customers/:id/history | oldgold:view | items + totals |
| GET | /gold/ledger | gold:view | filters type, branch, ref, product, oldgold, date |
| GET | /gold/lineage | gold:view | ?refEntity=&refId= both directions |
| GET | /gold/stock | gold:view | ?groupBy=purity\|branch\|stage |
| POST | /gold/ledger/adjustments | gold:manage | ADJUSTMENT/LOSS/RECOVERY + reason, threshold approval |
| POST | /melting/batches | gold:manage | branch → DRAFT MELT number |
| GET | /melting/batches | gold:view | filters status, branch |
| GET | /melting/batches/:id | gold:view | inputs + outputs + ledger rows |
| GET | /melting/batches/:id/label | gold:view | Code128 SVG, image/svg+xml |
| POST | /melting/batches/:id/items | gold:manage | AVAILABLE OG- ids → RESERVED |
| POST | /melting/batches/:id/lock | gold:manage | DRAFT → LOCKED |
| POST | /melting/batches/:id/melt | gold:manage | output + assay → difference |
| POST | /melting/batches/:id/approve | gold:manage | reason always; threshold approval; posts ledger |
| PATCH | /melting/batches/:id/void | gold:manage | DRAFT only + reason |
| POST | /manufacturing/orders | mfg:create | CUSTOMER needs customerId |
| GET | /manufacturing/orders | mfg:view | filters status, type, branch, customer |
| GET | /manufacturing/orders/:id | mfg:view | materials + outputs + ledger |
| POST | /manufacturing/orders/:id/materials | mfg:edit | refined lots, remaining enforced |
| POST | /manufacturing/orders/:id/produce | mfg:edit | exact balance + loss approval |
| POST | /manufacturing/orders/:id/qc | mfg:edit | pass or fail + reason |
| POST | /manufacturing/orders/:id/finish | mfg:edit | creates JW- products + ledger |
| PATCH | /manufacturing/orders/:id/void | mfg:edit | DRAFT/ALLOCATED only + reason |
| GET | /manufacturing/reports/summary | mfg:view | ?period=today\|month\|all |
| GET | /manufacturing/reports/wip | mfg:view | open orders with allocated fine |
