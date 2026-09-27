# GoldOS — Foundation Hardening Design

Date: 2026-09-28
Status: Approved
Scope: Auth completion, 8-role RBAC with full action matrix, user/branch
management, shell upgrades, dashboard placeholders, audit coverage, tests.
No sales, old gold, manufacturing, accounting.

## 1. Context

Phases 1–3 shipped auth (login/logout/sessions/scrypt), 4 roles, 9
`domain:verb` permissions, basic users/branches CRUD, shell, masters, and
products — API deployed, remote D1 at 0003. This phase hardens the platform
foundation per the master architecture before any business modules. Approach:
single coherent upgrade release (option A); sub-phasing (B) rejected as
triple overhead for coupled changes; compat shim (C) rejected per auto-remap
choice.

Decisions (user-confirmed):
- Auto-remap admin→owner, manager→manager, cashier→cashier, viewer→salesperson;
  old role rows removed by migration.
- Full domain×action matrix now (28 perms).
- Password reset via admin-issued single-use tokens (15-min); no email yet.

## 2. Auth

Keep: login, logout, D1 sessions (12h idle / 7d absolute), scrypt, httpOnly
Secure SameSite=None cookie, activation flag, audit on login/logout.
Add:
- `POST /auth/change-password` (auth): `{ currentPassword, newPassword>=8 }`;
  destroys caller's other sessions; audit `auth.password_change`.
- `password_resets(id, user_id FK, token_hash, expires_at, used_at NULL,
  created_at)`: `POST /auth/reset-request` (perm `users:edit`): creates token,
  returns plaintext once for out-of-band delivery, audit `auth.reset_request`;
  `POST /auth/reset-confirm` (public): `{ token, newPassword }`, verifies hash
  + expiry + unused, sets password, marks used, destroys all user sessions,
  audit `auth.reset_confirm`. Token = 32 random bytes hex; only hash stored.
- `PATCH /users/:id/activate` (perm `users:edit`, reason required) as
  counterpart to existing deactivate; self-activation-change forbidden.

## 3. RBAC

Vocabulary `domain:action`; actions view/create/edit/approve/cancel/reverse/
export/manage. Domains: users, roles, branches, settings, audit, masters,
products. Old→new mapping: read→view; write→create+edit (routes updated per
endpoint semantics, e.g. deactivate requires edit); branches:manage→
branches:manage; settings:write→settings:edit (+settings:manage for branch
keys); audit:read→audit:view (+audit:export). Masters/products keep
create+edit (approve/cancel/reverse/export added only where meaningful:
masters:export, products:export, products:cancel for void).
Roles (seeded grants):
- owner: all permissions.
- manager: all except users:approve, users:reverse, audit:manage.
- accountant: view all; export masters/products/audit; settings:view; no
  create/edit except none.
- cashier: masters:view, products:view, users:view (self branch scope).
- salesperson: masters:view, products:view.
- inventory_officer: masters full (view/create/edit/cancel/export),
  products full (view/create/edit/cancel/export), branches:view.
- gold_officer: masters:view + gold-rates create (masters:create covers rates
  POST) + masters:export; products:view.
- manufacturing_staff: products:view only.
Migration `0004_foundation`: insert roles/permissions/grants; remap
user_roles (admin→owner, manager→manager, cashier→cashier, viewer→
salesperson); delete old role rows + orphan grants. `requirePerm` unchanged
(pure string check — never role names). Sidebar + route guards use new names.

## 4. Users, branches, shell, dashboard

- Users page (`/users`, perm users:view): table + create dialog (name, email,
  password, role select of 8, branch multi-select) + edit dialog
  (name/role/branches, perm users:edit) + activate/deactivate (reason) +
  detail drawer with activity feed (`GET /audit?userId=` — new optional
  filter on audit route mapping to user_id column).
- Branches page (`/branches`): list + create/edit + activate/deactivate +
  settings tab (keys `branch.{id}.{key}` via settings routes; perm
  settings:manage to write, settings:view to read).
- Shell: breadcrumbs derived from pathname; header user menu (profile name,
  change-password dialog, sign out); notifications bell with empty state
  ("No notifications yet"); global search input disabled with tooltip;
  responsive sidebar → hidden under md with top-bar menu button; React error
  boundary around `(app)` content; existing skeletons retained.
- Dashboard: 8 cards (Today's Sales, Today's Purchases, Gold Purchased, Gold
  Sold, Cash, Inventory, Pending Approvals, Outstanding Receivables), each
  zero/empty state with "Connects in a later phase" hint. No real numbers.
- Audit: existing reusable service; new events auth.password_change,
  auth.reset_request, auth.reset_confirm, user.activate, user.edit,
  user.role_assign (part of edit payload diff), branch.settings_update.

## 5. Data flow example

Reset flow: manager calls reset-request → validate perm + target active →
gen token, store hash, batch [INSERT password_resets + audit] → return token
once → manager delivers out-of-band → user reset-confirm → verify →
batch [UPDATE users password, UPDATE password_resets used, DELETE sessions,
audit] → 200. Token reuse/replay impossible (used_at set in same batch).

## 6. Testing

Vitest: new schemas (change-password, reset-confirm, user edit);
matrix test (owner ⊇ all seeded perms; manufacturing_staff == {products:view}).
Live gate: login/logout, per-role RBAC deny matrix (cashier POST /users →
403; manufacturing_staff GET /masters → 403), deactivated login → 401,
branch scoping, full reset flow with token reuse → 401, audit rows for every
action above.

## 7. Out of scope

Sales, purchases, old gold, melting, manufacturing, accounting/ledgers,
email delivery, camera scanning, R2 uploads. Old 4 role names cease to exist.

## 8. Self-review

- No TBD/TODO; token format/expiry, matrix, remap, endpoint list explicit.
- Consistent: batch+audit, envelope, branch scoping, sidebar gating — all
  extend existing patterns; no new infra.
- Single-plan scope: foundation only, business modules untouched.
- Unambiguous: old→new perm mapping per endpoint class, exact grant sets,
  `branch.{id}.*` key format, `userId` audit filter fixed.
