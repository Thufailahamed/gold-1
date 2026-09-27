# GoldOS Permissions

RBAC: users → roles → permissions. `requireAuth` loads the caller's permission
set from `user_roles → role_permissions → permissions`; `requirePerm(perm)`
denies with 403 otherwise. Sidebar links hide without the matching permission.

| Permission | admin | manager | cashier | viewer |
|---|---|---|---|---|
| users:read | ✓ | ✓ | ✓ | — |
| users:write | ✓ | — | — | — |
| branches:manage | ✓ | ✓ | — | — |
| settings:write | ✓ | — | — | — |
| audit:read | ✓ | ✓ | — | — |
| masters:read | ✓ | ✓ | ✓ | — |
| masters:write | ✓ | ✓ | — | — |

Rules: sessions expire (12h idle / 7d absolute); inactive users are rejected;
deactivation needs a reason and is audited; users cannot deactivate themselves.
