-- 0047_rbac_three_roles.sql
-- Collapse the 8-role matrix to exactly 3 roles: owner, admin, staff.
-- Only owner holds accounts:view / accounts:manage (final accounts + profits).
-- Staff sells (sales:create, oldgold:create) and closes the day
-- (dayclose:view/manage). Reopening a closed day needs users:edit, which
-- staff does not hold, so only admin/owner can reopen.
-- Idempotent: safe to re-run; uses OR IGNORE and guarded deletes.

-- New operational permissions for the day close (split out of accounts:* so
-- staff can close without seeing the books).
INSERT OR IGNORE INTO permissions (id, name) VALUES
  ('dayclose:view', 'dayclose:view'),
  ('dayclose:manage', 'dayclose:manage');

-- The three roles.
INSERT OR IGNORE INTO roles (id, name) VALUES
  ('owner', 'owner'),
  ('admin', 'admin'),
  ('staff', 'staff');

-- Owner holds everything, including the two new permissions on existing DBs.
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions;

-- Admin: everything except owner-only financials and approvals.
DELETE FROM role_permissions WHERE role_id = 'admin';
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'admin', id FROM permissions WHERE id NOT IN (
  'accounts:view', 'accounts:manage',
  'users:approve', 'branches:approve', 'roles:manage'
);

-- Staff: counter sales + day close only.
DELETE FROM role_permissions WHERE role_id = 'staff';
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('staff', 'branches:view'),
  ('staff', 'masters:view'),
  ('staff', 'products:view'),
  ('staff', 'sales:view'),
  ('staff', 'sales:create'),
  ('staff', 'oldgold:view'),
  ('staff', 'oldgold:create'),
  ('staff', 'gold:view'),
  ('staff', 'dayclose:view'),
  ('staff', 'dayclose:manage');

-- Remap existing users onto the three roles (OR IGNORE avoids PK clashes
-- for users holding two old roles that map to the same new one).
INSERT OR IGNORE INTO user_roles (user_id, role_id)
SELECT user_id, 'admin' FROM user_roles WHERE role_id IN ('manager', 'accountant');
DELETE FROM user_roles WHERE role_id IN ('manager', 'accountant');
INSERT OR IGNORE INTO user_roles (user_id, role_id)
SELECT user_id, 'staff' FROM user_roles
WHERE role_id IN ('cashier', 'salesperson', 'inventory_officer', 'gold_officer', 'manufacturing_staff');
DELETE FROM user_roles WHERE role_id IN ('cashier', 'salesperson', 'inventory_officer', 'gold_officer', 'manufacturing_staff');

-- Drop the retired roles and their grants.
DELETE FROM role_permissions WHERE role_id IN ('manager', 'accountant', 'cashier', 'salesperson', 'inventory_officer', 'gold_officer', 'manufacturing_staff');
DELETE FROM roles WHERE id IN ('manager', 'accountant', 'cashier', 'salesperson', 'inventory_officer', 'gold_officer', 'manufacturing_staff');
