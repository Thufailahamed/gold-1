import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  createdBy: text("created_by"),
});

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull(),
    permissionId: text("permission_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) })
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) })
);

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  address: text("address"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const branchMembers = sqliteTable(
  "branch_members",
  {
    userId: text("user_id").notNull(),
    branchId: text("branch_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.branchId] }) })
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  prevJson: text("prev_json"),
  newJson: text("new_json"),
  reason: text("reason"),
  ip: text("ip"),
  branchId: text("branch_id"),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  type: text("type").notNull(),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  createdAt: integer("created_at").notNull(),
});
