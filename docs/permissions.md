# GoldOS Permissions

RBAC: users → roles → permissions. `requireAuth` loads the caller's permission
set from `user_roles → role_permissions → permissions`; `requirePerm(perm)`
denies with 403 otherwise. Authorization is permission-based — code never
checks role names. Sidebar links hide without the matching permission.

Vocabulary: `domain:action` with actions view/create/edit/approve/cancel/
reverse/export/manage. `reverse` is reserved for future transaction modules
(sales, purchases, old gold) and is not seeded yet.

| Permission | owner | manager | accountant | cashier | salesperson | inv. officer | gold officer | mfg staff |
|---|---|---|---|---|---|---|---|---|
| users:view | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| users:create | ✓ | ✓ | — | — | — | — | — | — |
| users:edit | ✓ | ✓ | — | — | — | — | — | — |
| users:approve | ✓ | — | — | — | — | — | — | — |
| users:cancel | ✓ | ✓ | — | — | — | — | — | — |
| users:export | ✓ | ✓ | — | — | — | — | — | — |
| roles:view | ✓ | ✓ | ✓ | — | — | — | — | — |
| roles:manage | ✓ | ✓ | — | — | — | — | — | — |
| branches:view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| branches:create | ✓ | ✓ | — | — | — | — | — | — |
| branches:edit | ✓ | ✓ | — | — | — | — | — | — |
| branches:approve | ✓ | — | — | — | — | — | — | — |
| branches:manage | ✓ | ✓ | — | — | — | — | — | — |
| settings:view | ✓ | ✓ | ✓ | — | — | — | — | — |
| settings:edit | ✓ | ✓ | — | — | — | — | — | — |
| settings:manage | ✓ | ✓ | — | — | — | — | — | — |
| audit:view | ✓ | ✓ | ✓ | — | — | — | — | — |
| audit:export | ✓ | ✓ | ✓ | — | — | — | — | — |
| masters:view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| masters:create | ✓ | ✓ | — | — | — | ✓ | ✓ | — |
| masters:edit | ✓ | ✓ | — | — | — | ✓ | — | — |
| masters:cancel | ✓ | ✓ | — | — | — | ✓ | — | — |
| masters:export | ✓ | ✓ | ✓ | — | — | ✓ | ✓ | — |
| products:view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| products:create | ✓ | ✓ | — | — | — | ✓ | — | — |
| products:edit | ✓ | ✓ | — | — | — | ✓ | — | — |
| products:cancel | ✓ | ✓ | — | — | — | ✓ | — | — |
| products:export | ✓ | ✓ | ✓ | — | — | ✓ | — | — |

Rules: sessions expire (12h idle / 7d absolute); inactive users are rejected;
activation changes need a reason and are audited; users cannot change their
own role or activation; role changes require users:approve; password resets
use single-use 15-minute tokens issued by users:edit holders.
