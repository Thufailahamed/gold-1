import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  description: text("description"),
  isActive: integer("is_active").notNull().default(1),
  branchId: text("branch_id"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const purities = sqliteTable("purities", {
  id: text("id").primaryKey(),
  karat: text("karat").notNull().unique(),
  permille: integer("permille").notNull(),
  defaultMakingCents: integer("default_making_cents").notNull().default(0),
  defaultWastageMg: integer("default_wastage_mg").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});

export const goldRates = sqliteTable("gold_rates", {
  id: text("id").primaryKey(),
  purityId: text("purity_id").notNull(),
  rateCentsPerG: integer("rate_cents_per_g").notNull(),
  effectiveFrom: integer("effective_from").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

function partyColumns() {
  return {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    nic: text("nic").unique(),
    creditLimitCents: integer("credit_limit_cents").notNull().default(0),
    openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    branchId: text("branch_id").notNull(),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by"),
  };
}

export const suppliers = sqliteTable("suppliers", partyColumns());
export const customers = sqliteTable("customers", partyColumns());

function catalogMaster(table: string) {
  return {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    isActive: integer("is_active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by"),
  };
}

export const subcategories = sqliteTable("subcategories", {
  ...catalogMaster("subcategories"),
  categoryId: text("category_id").notNull(),
});

export const designs = sqliteTable("designs", catalogMaster("designs"));
export const productTypes = sqliteTable("product_types", catalogMaster("product_types"));
export const metalTypes = sqliteTable("metal_types", catalogMaster("metal_types"));
export const stoneTypes = sqliteTable("stone_types", catalogMaster("stone_types"));

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  barcode: text("barcode").notNull().unique(),
  sku: text("sku").notNull().unique(),
  categoryId: text("category_id").notNull(),
  subcategoryId: text("subcategory_id"),
  designId: text("design_id"),
  productTypeId: text("product_type_id"),
  metalTypeId: text("metal_type_id").notNull(),
  stoneTypeId: text("stone_type_id"),
  purityId: text("purity_id").notNull(),
  name: text("name").notNull(),
  grossMg: integer("gross_mg").notNull(),
  stoneMg: integer("stone_mg").notNull().default(0),
  netMg: integer("net_mg").notNull(),
  fineGoldMg: integer("fine_gold_mg").notNull().default(0),
  makingCents: integer("making_cents").notNull().default(0),
  wastageMg: integer("wastage_mg").notNull().default(0),
  costCents: integer("cost_cents"),
  sellingPriceCents: integer("selling_price_cents"),
  location: text("location"),
  notes: text("notes"),
  imageKeys: text("image_keys").notNull().default("[]"),
  status: text("status").notNull().default("IN_STOCK"),
  branchId: text("branch_id").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const passwordResets = sqliteTable("password_resets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});
