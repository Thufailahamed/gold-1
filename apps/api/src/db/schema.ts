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
    code: text("code").unique(),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    nic: text("nic").unique(),
    notes: text("notes"),
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

export const chartOfAccounts = sqliteTable("chart_of_accounts", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  isActive: integer("is_active").notNull().default(1),
  branchId: text("branch_id"),
});

export const journalEntries = sqliteTable("journal_entries", {
  id: text("id").primaryKey(),
  accountCode: text("account_code").notNull(),
  debitCents: integer("debit_cents").notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  partyType: text("party_type"),
  partyId: text("party_id"),
  refEntity: text("ref_entity").notNull(),
  refId: text("ref_id").notNull(),
  memo: text("memo"),
  branchId: text("branch_id"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  type: text("type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  fromBranch: text("from_branch"),
  toBranch: text("to_branch"),
  weightMg: integer("weight_mg").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const counters = sqliteTable("counters", {
  name: text("name").primaryKey(),
  next: integer("next").notNull().default(1),
});

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  supplierId: text("supplier_id").notNull(),
  branchId: text("branch_id").notNull(),
  status: text("status").notNull().default("DRAFT"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const purchaseOrderItems = sqliteTable("purchase_order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  categoryId: text("category_id").notNull(),
  purityId: text("purity_id").notNull(),
  grossMg: integer("gross_mg").notNull(),
  netMg: integer("net_mg").notNull(),
  estCostCents: integer("est_cost_cents").notNull(),
  notes: text("notes"),
});

export const purchaseInvoices = sqliteTable("purchase_invoices", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  orderId: text("order_id"),
  supplierId: text("supplier_id").notNull(),
  branchId: text("branch_id").notNull(),
  subtotalCents: integer("subtotal_cents").notNull(),
  chargesCents: integer("charges_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  paidCents: integer("paid_cents").notNull().default(0),
  status: text("status").notNull().default("UNPAID"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const purchaseInvoiceItems = sqliteTable("purchase_invoice_items", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  productId: text("product_id").notNull(),
  grossMg: integer("gross_mg").notNull(),
  netMg: integer("net_mg").notNull(),
  purityId: text("purity_id").notNull(),
  costCents: integer("cost_cents").notNull(),
  makingCents: integer("making_cents").notNull().default(0),
});

export const purchasePayments = sqliteTable("purchase_payments", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull(),
  refEntity: text("ref_entity").notNull().default("purchase_payment"),
  refId: text("ref_id").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const salesInvoices = sqliteTable("sales_invoices", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  customerId: text("customer_id"),
  branchId: text("branch_id").notNull(),
  salespersonId: text("salesperson_id"),
  subtotalCents: integer("subtotal_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  paidCents: integer("paid_cents").notNull().default(0),
  status: text("status").notNull().default("UNPAID"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const salesItems = sqliteTable("sales_items", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  productId: text("product_id").notNull(),
  priceCents: integer("price_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  costCents: integer("cost_cents").notNull(),
});

export const salesPayments = sqliteTable("sales_payments", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  method: text("method").notNull(),
  refEntity: text("ref_entity").notNull().default("sale_payment"),
  refId: text("ref_id").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const salesReturns = sqliteTable("sales_returns", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  invoiceId: text("invoice_id").notNull(),
  type: text("type").notNull(),
  reason: text("reason").notNull(),
  approvedBy: text("approved_by"),
  refundCents: integer("refund_cents").notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  exchangeSaleId: text("exchange_sale_id"),
  status: text("status").notNull().default("COMPLETE"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const salesReturnItems = sqliteTable("sales_return_items", {
  id: text("id").primaryKey(),
  returnId: text("return_id").notNull(),
  productId: text("product_id").notNull(),
  invoiceItemId: text("invoice_item_id").notNull(),
});

export const goldMovements = sqliteTable("gold_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id"),
  oldGoldId: text("old_gold_id"),
  direction: text("direction").notNull(),
  fineMg: integer("fine_mg").notNull(),
  purityPermille: integer("purity_permille").notNull(),
  refEntity: text("ref_entity").notNull(),
  refId: text("ref_id").notNull(),
  branchId: text("branch_id"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const oldGoldItems = sqliteTable("old_gold_items", {
  id: text("id").primaryKey(),
  number: text("number").notNull().unique(),
  customerId: text("customer_id").notNull(),
  branchId: text("branch_id").notNull(),
  itemType: text("item_type").notNull(),
  description: text("description").notNull(),
  grossMg: integer("gross_mg").notNull(),
  stoneMg: integer("stone_mg").notNull().default(0),
  netMg: integer("net_mg").notNull(),
  purityId: text("purity_id"),
  testedPermille: integer("tested_permille"),
  karat: text("karat"),
  fineMg: integer("fine_mg").notNull().default(0),
  rateCentsPerG: integer("rate_cents_per_g"),
  buyPct: real("buy_pct"),
  purchaseRateCents: integer("purchase_rate_cents"),
  stoneDeductionCents: integer("stone_deduction_cents").notNull().default(0),
  processingDeductionCents: integer("processing_deduction_cents").notNull().default(0),
  negotiatedCents: integer("negotiated_cents"),
  purchaseValueCents: integer("purchase_value_cents"),
  paidCents: integer("paid_cents").notNull().default(0),
  status: text("status").notNull().default("RECEIVED"),
  convertedProductId: text("converted_product_id"),
  staffId: text("staff_id"),
  notes: text("notes"),
  imageKeys: text("image_keys").notNull().default("[]"),
  docKeys: text("doc_keys").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const goldTests = sqliteTable("gold_tests", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  method: text("method").notNull(),
  testedPermille: integer("tested_permille").notNull(),
  testerId: text("tester_id").notNull(),
  result: text("result").notNull(),
  approvedBy: text("approved_by"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
});

export const oldGoldPurchases = sqliteTable("old_gold_purchases", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().unique(),
  valueCents: integer("value_cents").notNull(),
  paidCents: integer("paid_cents").notNull(),
  method: text("method").notNull(),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});
