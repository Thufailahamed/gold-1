CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE permissions (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE branch_members (
  user_id TEXT NOT NULL REFERENCES users(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  PRIMARY KEY (user_id, branch_id)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  prev_json TEXT,
  new_json TEXT,
  reason TEXT,
  ip TEXT,
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  type TEXT NOT NULL
);
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
