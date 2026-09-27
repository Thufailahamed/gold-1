CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
INSERT INTO roles (id, name) VALUES
  ('owner', 'owner'),
  ('accountant', 'accountant'),
  ('salesperson', 'salesperson'),
  ('inventory_officer', 'inventory_officer'),
  ('gold_officer', 'gold_officer'),
  ('manufacturing_staff', 'manufacturing_staff');
UPDATE user_roles SET role_id = 'owner' WHERE role_id = 'admin';
UPDATE user_roles SET role_id = 'salesperson' WHERE role_id = 'viewer';
DELETE FROM role_permissions WHERE role_id IN ('admin', 'manager', 'cashier', 'viewer');
DELETE FROM roles WHERE id IN ('admin', 'viewer');
DELETE FROM role_permissions WHERE permission_id IN (
  'users:read', 'users:write', 'branches:manage', 'settings:write',
  'audit:read', 'masters:read', 'masters:write', 'products:read', 'products:write'
);
DELETE FROM permissions WHERE id IN (
  'users:read', 'users:write', 'branches:manage', 'settings:write',
  'audit:read', 'masters:read', 'masters:write', 'products:read', 'products:write'
);
INSERT INTO permissions (id, name) VALUES
  ('users:view', 'users:view'), ('users:create', 'users:create'),
  ('users:edit', 'users:edit'), ('users:approve', 'users:approve'),
  ('users:cancel', 'users:cancel'), ('users:export', 'users:export'),
  ('roles:view', 'roles:view'), ('roles:manage', 'roles:manage'),
  ('branches:view', 'branches:view'), ('branches:create', 'branches:create'),
  ('branches:edit', 'branches:edit'), ('branches:approve', 'branches:approve'),
  ('branches:manage', 'branches:manage'),
  ('settings:view', 'settings:view'), ('settings:edit', 'settings:edit'),
  ('settings:manage', 'settings:manage'),
  ('audit:view', 'audit:view'), ('audit:export', 'audit:export'),
  ('masters:view', 'masters:view'), ('masters:create', 'masters:create'),
  ('masters:edit', 'masters:edit'), ('masters:cancel', 'masters:cancel'),
  ('masters:export', 'masters:export'),
  ('products:view', 'products:view'), ('products:create', 'products:create'),
  ('products:edit', 'products:edit'), ('products:cancel', 'products:cancel'),
  ('products:export', 'products:export');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions;
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id NOT IN ('users:approve', 'branches:approve');
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'users:view'), ('accountant', 'roles:view'),
  ('accountant', 'branches:view'), ('accountant', 'settings:view'),
  ('accountant', 'audit:view'), ('accountant', 'audit:export'),
  ('accountant', 'masters:view'), ('accountant', 'masters:export'),
  ('accountant', 'products:view'), ('accountant', 'products:export'),
  ('cashier', 'users:view'), ('cashier', 'branches:view'),
  ('cashier', 'masters:view'), ('cashier', 'products:view'),
  ('salesperson', 'branches:view'), ('salesperson', 'masters:view'),
  ('salesperson', 'products:view'),
  ('inventory_officer', 'branches:view'),
  ('inventory_officer', 'masters:view'), ('inventory_officer', 'masters:create'),
  ('inventory_officer', 'masters:edit'), ('inventory_officer', 'masters:cancel'),
  ('inventory_officer', 'masters:export'),
  ('inventory_officer', 'products:view'), ('inventory_officer', 'products:create'),
  ('inventory_officer', 'products:edit'), ('inventory_officer', 'products:cancel'),
  ('inventory_officer', 'products:export'),
  ('gold_officer', 'branches:view'), ('gold_officer', 'masters:view'),
  ('gold_officer', 'masters:create'), ('gold_officer', 'masters:export'),
  ('gold_officer', 'products:view'),
  ('manufacturing_staff', 'products:view');
