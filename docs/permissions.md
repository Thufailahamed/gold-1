# GoldOS Permissions

Three roles only: **owner, admin, staff**.

RBAC: users → roles → permissions. `requireAuth` loads the caller's permission
set from `user_roles → role_permissions → permissions`; `requirePerm(perm)`
denies with 403 otherwise. Authorization is permission-based — code never
checks role names. Sidebar links hide without the matching permission.

- **owner** holds every permission. Only the owner sees final accounts and
  profits: `accounts:view` / `accounts:manage` (journal, trial balance,
  P&L, balance sheet, reconciliation, fiscal close, adjustments, tax report)
  plus `users:approve`, `branches:approve` and `roles:manage` are owner-only.
- **admin** runs the shop — users, branches, settings, audit, masters,
  products, purchases, sales, old gold, gold, manufacturing, day close —
  but holds NO `accounts:*`, so no statements and no profit figures. Book
  costs stay visible to admin (purchasing and pricing need them).
- **staff** works the counter: `branches:view`, `masters:view`,
  `products:view`, `sales:view` + `sales:create`, `oldgold:view` +
  `oldgold:create`, `gold:view`, `dayclose:view` + `dayclose:manage`.
  Staff can make sales (including old-for-new exchanges at the till with an
  admin-valued item) and close the day. Staff never sees book costs
  (`cost_cents` and COGS lines are stripped from product, catalog and sale
  responses), never sees purchasing, and cannot reopen a closed day —
  reopening needs `users:edit`, which staff does not hold.

Day close lives under its own permissions so staff can close without seeing
the books: `dayclose:view` (preview, investigate, survey, reports, variance,
unclosed) and `dayclose:manage` (close, auto-close). Reopening is an
admin/owner action gated by `users:edit`.

Vocabulary: `domain:action` with actions view/create/edit/approve/cancel/
reverse/export/manage. `reverse` is reserved for future transaction modules
(sales, purchases, old gold) and is not seeded yet.

| Permission | owner | admin | staff |
|---|---|---|---|
| users:view | ✓ | ✓ | — |
| users:create | ✓ | ✓ | — |
| users:edit | ✓ | ✓ | — |
| users:approve | ✓ | — | — |
| users:cancel | ✓ | ✓ | — |
| users:export | ✓ | ✓ | — |
| roles:view | ✓ | ✓ | — |
| roles:manage | ✓ | — | — |
| branches:view | ✓ | ✓ | ✓ |
| branches:create | ✓ | ✓ | — |
| branches:edit | ✓ | ✓ | — |
| branches:approve | ✓ | — | — |
| branches:manage | ✓ | ✓ | — |
| settings:view | ✓ | ✓ | — |
| settings:edit | ✓ | ✓ | — |
| settings:manage | ✓ | ✓ | — |
| audit:view | ✓ | ✓ | — |
| audit:export | ✓ | ✓ | — |
| masters:view | ✓ | ✓ | ✓ |
| masters:create | ✓ | ✓ | — |
| masters:edit | ✓ | ✓ | — |
| masters:cancel | ✓ | ✓ | — |
| masters:export | ✓ | ✓ | — |
| products:view | ✓ | ✓ | ✓ |
| products:create | ✓ | ✓ | — |
| products:edit | ✓ | ✓ | — |
| products:cancel | ✓ | ✓ | — |
| products:export | ✓ | ✓ | — |
| accounts:view | ✓ | — | — |
| accounts:manage | ✓ | — | — |
| purchases:view | ✓ | ✓ | — |
| purchases:create | ✓ | ✓ | — |
| purchases:edit | ✓ | ✓ | — |
| purchases:cancel | ✓ | ✓ | — |
| purchases:export | ✓ | ✓ | — |
| sales:view | ✓ | ✓ | ✓ |
| sales:create | ✓ | ✓ | ✓ |
| sales:edit | ✓ | ✓ | — |
| sales:cancel | ✓ | ✓ | — |
| sales:export | ✓ | ✓ | — |
| sales:approve | ✓ | ✓ | — |
| oldgold:view | ✓ | ✓ | ✓ |
| oldgold:create | ✓ | ✓ | ✓ |
| oldgold:edit | ✓ | ✓ | — |
| oldgold:cancel | ✓ | ✓ | — |
| oldgold:export | ✓ | ✓ | — |
| oldgold:approve | ✓ | ✓ | — |
| gold:view | ✓ | ✓ | ✓ |
| gold:manage | ✓ | ✓ | — |
| mfg:view | ✓ | ✓ | — |
| mfg:create | ✓ | ✓ | — |
| mfg:edit | ✓ | ✓ | — |
| mfg:approve | ✓ | ✓ | — |
| dayclose:view | ✓ | ✓ | ✓ |
| dayclose:manage | ✓ | ✓ | ✓ |

Rules: sessions expire (12h idle / 7d absolute); inactive users are rejected;
activation changes need a reason and are audited; users cannot change their
own role or activation; role changes require users:approve; password resets
use single-use 15-minute tokens issued by users:edit holders.

## Ledger core (migrations `0015`-`0017`)

`accounts:manage` covers chart-of-accounts CRUD and journal reversal in
addition to manual adjustments. It is owner-only, as is `accounts:view`
(journal list, trial balance, account statement, reconciliation report,
P&L, balance sheet). No non-owner role can read the books.

## Three-role cutover (migration `0047`)

The old eight roles (`manager`, `accountant`, `cashier`, `salesperson`,
`inventory_officer`, `gold_officer`, `manufacturing_staff`) are remapped —
`manager`/`accountant` → `admin`, the rest → `staff` — and then deleted.
Two operational permissions were added so staff can close the day without
seeing the books: `dayclose:view` (55 total) and `dayclose:manage`.
The count is **55** across 3 roles.
