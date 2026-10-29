import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
  role: z.enum(["owner", "admin", "staff"]),
  branchIds: z.array(z.string().min(1)).min(1),
});

export const createBranchSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  address: z.string().max(500).optional(),
});

export const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
  type: z.enum(["string", "number", "boolean", "json"]),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  description: z.string().max(500).optional(),
});

export const createPuritySchema = z.object({
  karat: z.string().min(1).max(10),
  permille: z.number().int().gt(0).lte(1000),
  defaultMakingLkr: z.number().min(0).optional().default(0),
  defaultWastageMg: z.number().min(0).optional().default(0),
});

export const createGoldRateSchema = z.object({
  purityId: z.string().min(1),
  ratePerGram: z.number().gt(0),
  effectiveFrom: z.number().int().positive(),
  approvalId: z.string().min(1).optional(),
  approvalEntityId: z.string().min(1).optional(),
});

export const createPartySchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  nic: z.string().max(20).optional(),
  creditLimit: z.number().min(0).optional().default(0),
  notes: z.string().max(2000).optional(),
  branchId: z.string().min(1),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreatePurityInput = z.infer<typeof createPuritySchema>;
export type CreateGoldRateInput = z.infer<typeof createGoldRateSchema>;
export type CreatePartyInput = z.infer<typeof createPartySchema>;

/**
 * A piece's barcode: its category code, a dash, two letters, a dash, then a
 * four-digit number (BBR-AA-0001). Older tags were BBRAA0001, and PRD-/JW-.
 */
export const BARCODE_RE = /^([A-Z0-9]{1,12}-[A-Z]{2}-\d{4,}|[A-Z0-9]{1,12}[A-Z]{2}\d{4,}|(PRD|JW)-[A-Z0-9]{6})$/;

/**
 * Scanner input → the canonical stored form. Codes are minted uppercase, so
 * normalising lets lookups hit the unique barcode/sku indexes instead of
 * scanning with UPPER(). Scanners can also leak whitespace or control chars
 * (CR/LF/Tab suffixes, GS1 FNC1 as \x1d) around the payload.
 */
export function normalizeCode(code: string): string {
  // eslint-disable-next-line no-control-regex
  return code.replace(/[\x00-\x20\x7f]/g, "").trim().toUpperCase();
}

/**
 * The code inside whatever a scanner read. A Code128 tag gives the bare code;
 * a QR tag may carry the bare code, a link to the piece
 * (…/products/barcode/JW-XXXX, …?code=JW-XXXX) or a small JSON payload
 * ({"barcode":"JW-XXXX"}). All of them come back as the normalized code.
 */
export function extractScanCode(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      const v = j.barcode ?? j.code ?? j.sku ?? j.number;
      if (typeof v === "string") return normalizeCode(v);
    } catch {
      // Not JSON after all: treat it as a plain code.
    }
  }
  if (/^https?:\/\//i.test(s)) {
    const q = s.match(/[?&](?:code|barcode|add)=([^&#]+)/i);
    if (q?.[1]) return normalizeCode(decodeURIComponent(q[1]));
    const seg = s.replace(/[?#].*$/, "").split("/").filter(Boolean).pop();
    if (seg) return normalizeCode(decodeURIComponent(seg));
  }
  return normalizeCode(s);
}

const optRef = z.string().min(1).optional().or(z.literal("")).transform((v) => v || undefined);

export const createProductSchema = z.object({
  /** Optional code name; blank falls back to the subcategory / category name. */
  name: z.string().trim().max(100).optional().or(z.literal("")).transform((v) => v || undefined),
  categoryId: z.string().min(1),
  branchId: z.string().min(1),
  subcategoryId: optRef,
  /** Free-text subcategory; matched by name within the category, created if new. */
  subcategoryName: z.string().trim().max(100).optional().or(z.literal("")).transform((v) => v || undefined),
  designId: optRef,
  productTypeId: optRef,
  metalTypeId: z.string().min(1),
  stoneTypeId: optRef,
  purityId: z.string().min(1),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  wastageG: z.number().min(0).optional().default(0),
  costLkr: z.number().min(0).optional(),
  location: z.string().max(100).optional().or(z.literal("")).transform((v) => v || undefined),
  notes: z.string().max(2000).optional().or(z.literal("")).transform((v) => v || undefined),
});

export const editProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subcategoryId: optRef,
  designId: optRef,
  productTypeId: optRef,
  metalTypeId: z.string().min(1).optional(),
  stoneTypeId: optRef,
  makingLkr: z.number().min(0).optional(),
  wastageG: z.number().min(0).optional(),
  costLkr: z.number().min(0).optional(),
  sellingPriceLkr: z.number().min(0).optional(),
  location: z.string().max(100).optional().or(z.literal("")).transform((v) => v || undefined),
  notes: z.string().max(2000).optional().or(z.literal("")).transform((v) => v || undefined),
  approvalId: z.string().min(1).optional(),
});

const refSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
});

export const createSubcategorySchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
});
export const createDesignSchema = refSchema;
export const createProductTypeSchema = refSchema;
export const createMetalTypeSchema = refSchema;
export const createStoneTypeSchema = refSchema;

/** Most pieces one bulk intake may carry — one tray, saved in one batch. */
export const BULK_PRODUCTS_MAX = 100;

/**
 * Many like pieces at once (a tray of 25 rings): everything they share is
 * sent once in `common`; each item carries what differs — always its weight,
 * optionally its own category, subcategory, name, stone, making, wastage, cost,
 * price, tray or note. An item field overrides the common one.
 */
const bulkItemSchema = createProductSchema
  .pick({
    name: true,
    grossG: true,
    location: true,
    notes: true,
  })
  .extend({
    categoryId: optRef,
    subcategoryName: createProductSchema.shape.subcategoryName,
    stoneG: z.number().min(0).max(100000).optional(),
    makingLkr: z.number().min(0).optional(),
    wastageG: z.number().min(0).optional(),
    costLkr: z.number().min(0).optional(),
  });

export const bulkCreateProductsSchema = z.object({
  // The tray may name no category; then every row must name its own.
  common: createProductSchema.omit({ grossG: true, categoryId: true }).extend({ categoryId: optRef }),
  items: z.array(bulkItemSchema).min(1).max(BULK_PRODUCTS_MAX),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type BulkCreateProductsInput = z.infer<typeof bulkCreateProductsSchema>;
export type EditProductInput = z.infer<typeof editProductSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const resetRequestSchema = z.object({
  email: z.string().email(),
});

export const resetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const roleEnum = z.enum(["owner", "admin", "staff"]);

export const editUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: roleEnum.optional(),
  branchIds: z.array(z.string().min(1)).min(1).optional(),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type EditUserInput = z.infer<typeof editUserSchema>;

const purchaseItemSchema = z.object({
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional(),
  designId: z.string().min(1).optional(),
  productTypeId: z.string().min(1).optional(),
  metalTypeId: z.string().min(1),
  stoneTypeId: z.string().min(1).optional(),
  purityId: z.string().min(1),
  name: z.string().min(1).max(100),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  wastageG: z.number().min(0).optional().default(0),
  costLkr: z.number().min(0),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const createOrderSchema = z.object({
  supplierId: z.string().min(1),
  branchId: z.string().min(1),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      purchaseItemSchema.omit({ location: true, notes: true, costLkr: true }).extend({
        estCostLkr: z.number().min(0),
        notes: z.string().max(2000).optional(),
      })
    )
    .min(1),
});

export const createInvoiceSchema = z.object({
  orderId: z.string().min(1).optional(),
  supplierId: z.string().min(1),
  branchId: z.string().min(1),
  chargesLkr: z.number().min(0).optional().default(0),
  paidLkr: z.number().min(0).optional().default(0),
  paidBankAccountId: z.string().min(1).optional(),
  items: z.array(purchaseItemSchema).min(1),
});

export const payInvoiceSchema = z.object({
  amountLkr: z.number().gt(0),
  bankAccountId: z.string().min(1),
});

export const voidInvoiceSchema = z.object({ reason: z.string().min(1).max(500), approvalId: z.string().min(1).optional() });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

const saleItemSchema = z.object({
  productId: z.string().min(1),
  /** The price to charge. With `listPriceLkr` it may differ from the shelf price. */
  priceLkr: z.number().min(0).optional(),
  /** The shelf price the cashier was shown; lets the till negotiate `priceLkr`. */
  listPriceLkr: z.number().min(0).optional(),
  discountLkr: z.number().min(0).optional().default(0),
});

const splitPaySchema = z.object({
  /** A cheque is taken as cash: it posts to the drawer, with its details kept on the bill. */
  method: z.enum(["cash", "cheque", "card", "bank", "credit", "other"]),
  amountLkr: z.number().gt(0),
  chequeNo: z.string().trim().max(40).optional(),
  chequeBank: z.string().trim().max(80).optional(),
  chequeDate: z.string().trim().max(20).optional(),
  /** The bank account a "bank" payment went into; without it, 1010. */
  bankAccountId: z.string().min(1).optional(),
});

export const createSaleSchema = z.object({
  customerId: z.string().min(1).optional(),
  branchId: z.string().min(1),
  salespersonId: z.string().min(1).optional(),
  items: z.array(saleItemSchema).min(1),
  payments: z.array(splitPaySchema).min(1),
  approvedBy: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  approvalEntityId: z.string().min(1).optional(),
  exchangeReturnId: z.string().min(1).optional(),
  /** Cash handed over at the till, printed as tendered / change. */
  tenderedLkr: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const createReturnSchema = z.object({
  invoiceId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).optional(),
  type: z.enum(["FULL", "PARTIAL", "EXCHANGE"]),
  reason: z.string().min(1).max(500),
  refundMethod: z.enum(["original", "cash", "bank", "credit"]).optional().default("original"),
  /** The bank account a "bank" refund leaves from; without it, 1010. */
  refundBankAccountId: z.string().min(1).optional(),
  approvedBy: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

/**
 * Old-for-new exchange at the counter: VALUED old-gold items are bought from
 * the customer and settled against a new sale in one atomic batch. The
 * customer pays the difference when the new items cost more; when the old
 * gold is worth more the shop pays the difference out of the drawer, or
 * leaves it as store credit on the customer's account.
 */
export const exchangeSaleSchema = z.object({
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  /** Old gold already valued for this customer, ticked on the till. */
  oldGoldItemIds: z.array(z.string().min(1)).default([]),
  /**
   * Old gold brought in with this sale and not yet on record: weighed and
   * priced at the counter. It is written only if the sale itself is.
   */
  newOldGold: z
    .array(
      z.object({
        grossG: z.number().gt(0).max(100000),
        valueLkr: z.number().gt(0),
        /** What the piece is, as the desk would record it. Defaults to its weight. */
        description: z.string().min(1).max(200).optional(),
        /** The old gold category it is filed under. Blank files it under OG. */
        categoryId: z.string().min(1).optional(),
      })
    )
    .max(100)
    .default([]),
  items: z.array(saleItemSchema).min(1),
  /** Real-money legs toward the difference the customer owes. */
  payments: z.array(splitPaySchema).optional().default([]),
  /** Where the surplus goes when the old gold is worth more than the bill. */
  payout: z.enum(["cash", "store_credit"]).optional().default("cash"),
  salespersonId: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),
});

export type ExchangeSaleInput = z.infer<typeof exchangeSaleSchema>;

export const TEST_METHODS = ["acid", "touchstone", "xrf", "electronic", "fire_assay"] as const;
export const OLDGOLD_STATUSES = ["RECEIVED", "TESTED", "VALUED", "PURCHASED", "AVAILABLE", "RESERVED_FOR_MELTING", "MELTED", "RESOLD", "TRANSFERRED", "VOID"] as const;

/**
 * The built-in customer that holds the shop's own old gold (no seller). Created
 * on first use per shop and hidden from customer lists.
 */
export const SHOP_STOCK_CUSTOMER_ID = "shop-stock";

export const createOldGoldSchema = z.object({
  /** The seller. Blank only when the piece is the shop's own stock (shopOwned). */
  customerId: z.string().min(1).optional(),
  /**
   * Old gold the shop already holds: no seller, no purchase. It goes straight to
   * AVAILABLE at the cost given. Its cost and karat are optional; no testing queue.
   */
  shopOwned: z.boolean().optional(),
  /** Book cost in LKR of a shop-owned piece: what it enters inventory at. */
  costLkr: z.number().gt(0).max(10_000_000).optional(),
  branchId: z.string().min(1),
  /** Optional; the piece is recorded as "Old gold" when it is blank. */
  itemType: z.string().min(1).max(50).optional(),
  /** Optional; blank records the piece as "Old gold, X g", the same as a till take-in. */
  description: z.string().min(1).max(500).optional(),
  /** One of the old gold categories. Blank files it under OG, the default. */
  categoryId: z.string().min(1).optional(),
  /**
   * Off by default: a karat chosen means the piece goes straight to Tested.
   * On, or with no karat chosen: it waits in the testing queue.
   */
  needsTesting: z.boolean().optional(),
  purityId: z.string().min(1).optional(),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  /** Price per gram of net weight, typed at intake. The price is net × this rate. */
  quotedRateLkr: z.number().gt(0).max(10_000_000).optional(),
  notes: z.string().max(2000).optional(),
});

export const testOldGoldSchema = z.object({
  method: z.enum(TEST_METHODS),
  permille: z.number().int().gt(0).lte(1000),
  result: z.enum(["pass", "fail", "inconclusive"]),
  notes: z.string().max(2000).optional(),
  approvedBy: z.string().min(1).optional(),
});

export const valueOldGoldSchema = z.object({
  buyPct: z.number().gt(0).lte(100).optional(),
  stoneDeductionLkr: z.number().min(0).optional().default(0),
  processingDeductionLkr: z.number().min(0).optional().default(0),
  negotiatedLkr: z.number().gt(0).optional(),
  reason: z.string().max(500).optional(),
  approvalId: z.string().min(1).optional(),
});

export const purchaseOldGoldSchema = z.object({
  paidLkr: z.number().min(0),
  method: z.enum(["cash", "bank"]),
});

export const voidOldGoldSchema = z.object({ reason: z.string().min(1).max(500) });

/**
 * A piece bought from a customer and put straight into stock: taken in at its
 * karat and price per gram, paid for, and released to stock in one request.
 * There is no testing step.
 */
export const buyInOldGoldSchema = createOldGoldSchema.extend({
  customerId: z.string().min(1),
  purityId: z.string().min(1),
  quotedRateLkr: z.number().gt(0).max(10_000_000),
  /** What is paid now. Blank pays the full value; less leaves the rest owed to the customer. */
  paidLkr: z.number().min(0).optional(),
  method: z.enum(["cash", "bank"]).default("cash"),
});

export type BuyInOldGoldInput = z.infer<typeof buyInOldGoldSchema>;
export type CreateOldGoldInput = z.infer<typeof createOldGoldSchema>;
export type TestOldGoldInput = z.infer<typeof testOldGoldSchema>;
export type ValueOldGoldInput = z.infer<typeof valueOldGoldSchema>;

export const GOLD_TYPES = ["PURCHASE", "OLD_GOLD_PURCHASE", "SALE", "MELTING_INPUT", "MELTING_OUTPUT", "MANUFACTURING_INPUT", "MANUFACTURING_OUTPUT", "TRANSFER", "RETURN", "ADJUSTMENT", "LOSS", "RECOVERY"] as const;

export const createMeltSchema = z.object({
  branchId: z.string().min(1),
  notes: z.string().max(2000).optional(),
});

export const addMeltItemsSchema = z.object({
  oldGoldIds: z.array(z.string().min(1)).min(1).max(50),
});

export const meltRecordSchema = z.object({
  outputWeightG: z.number().gt(0).max(100000),
  assayPermille: z.number().int().gt(0).lte(1000),
  wasteG: z.number().min(0).max(100000).optional().default(0),
  outputType: z.enum(["grain", "bar"]).optional().default("grain"),
});

export const approveMeltSchema = z.object({
  reason: z.string().min(1).max(500),
  approvedBy: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
});

export const adjustGoldSchema = z.object({
  type: z.enum(["ADJUSTMENT", "LOSS", "RECOVERY"]),
  branchId: z.string().min(1),
  weightG: z.number().gt(0).max(100000),
  permille: z.number().int().gt(0).lte(1000),
  reason: z.string().min(1).max(500),
  approvedBy: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  approvalEntityId: z.string().min(1).optional(),
});

export type CreateMeltInput = z.infer<typeof createMeltSchema>;
export type ApproveMeltInput = z.infer<typeof approveMeltSchema>;

export const createMfgOrderSchema = z.object({
  type: z.enum(["CUSTOMER", "INTERNAL"]),
  customerId: z.string().min(1).optional(),
  branchId: z.string().min(1),
  design: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueAt: z.number().int().positive().optional(),
});

export const addMfgMaterialsSchema = z.object({
  lots: z.array(z.object({
    lotBatchId: z.string().min(1),
    lotNumber: z.string().min(1),
    fineMg: z.number().int().gt(0),
  })).min(1).max(20),
});

const mfgOutputSchema = z.object({
  categoryId: z.string().min(1),
  metalTypeId: z.string().min(1),
  purityId: z.string().min(1),
  name: z.string().min(1).max(100),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  location: z.string().max(100).optional(),
});

export const produceMfgSchema = z.object({
  outputs: z.array(mfgOutputSchema).min(1).max(20),
  labourLkr: z.number().min(0).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  stoneCostLkr: z.number().min(0).optional().default(0),
  lossMg: z.number().int().min(0).optional().default(0),
  lossReason: z.string().max(500).optional(),
  approvedBy: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
});

export const qcMfgSchema = z.object({
  pass: z.boolean(),
  reason: z.string().max(500).optional(),
});

export type CreateMfgOrderInput = z.infer<typeof createMfgOrderSchema>;
export type ProduceMfgInput = z.infer<typeof produceMfgSchema>;

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

export const createAccountSchema = z.object({
  code: z.string().regex(/^\d{4}$/, "Account code must be four digits"),
  name: z.string().min(1).max(100),
  type: z.enum(ACCOUNT_TYPES),
  description: z.string().max(500).optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
});

export const accountStatusSchema = z.object({
  isActive: z.union([z.literal(0), z.literal(1)]),
  reason: z.string().min(1).max(500),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

const BUSINESS_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CENTS = z.number().int();

export const createBankAccountSchema = z.object({
  name: z.string().min(1).max(100),
  bankName: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  branchId: z.string().min(1).optional(),
});

export const updateBankAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bankName: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  isActive: z.union([z.literal(0), z.literal(1)]).optional(),
  reason: z.string().min(1).max(500),
});

export const openingBalanceSchema = z.object({
  amountCents: CENTS.positive(),
  reason: z.string().min(1).max(500),
  entryDate: BUSINESS_DATE.optional(),
});

export const cashMoveSchema = z.object({
  branchId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amountCents: CENTS.positive(),
  note: z.string().max(500).optional(),
  entryDate: BUSINESS_DATE.optional(),
});

export const transferDispatchSchema = z.object({
  fromBranchId: z.string().min(1),
  toBranchId: z.string().min(1),
  amountCents: CENTS.positive(),
  sentOn: BUSINESS_DATE.optional(),
  reason: z.string().min(1).max(500),
});

export const transferReceiveSchema = z.object({
  receivedOn: BUSINESS_DATE.optional(),
  note: z.string().max(500).optional(),
});

export const cardSettlementSchema = z.object({
  bankAccountId: z.string().min(1),
  grossCents: CENTS.positive(),
  feeCents: CENTS.min(0).optional().default(0),
  settledOn: BUSINESS_DATE.optional(),
  acquirerRef: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export const reconcileStatementSchema = z.object({
  statementDate: BUSINESS_DATE,
  statementBalanceCents: CENTS,
  note: z.string().max(500).optional(),
});

export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>;
export type OpeningBalanceInput = z.infer<typeof openingBalanceSchema>;
export type CashMoveInput = z.infer<typeof cashMoveSchema>;
export type TransferDispatchInput = z.infer<typeof transferDispatchSchema>;
export type TransferReceiveInput = z.infer<typeof transferReceiveSchema>;
export type CardSettlementInput = z.infer<typeof cardSettlementSchema>;
export type ReconcileStatementInput = z.infer<typeof reconcileStatementSchema>;

export const createExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const expenseStatusSchema = z.object({
  isActive: z.union([z.literal(0), z.literal(1)]),
  reason: z.string().min(1).max(500),
});

export const createExpenseSchema = z.object({
  categoryId: z.string().min(1),
  branchId: z.string().min(1),
  amountLkr: z.number().gt(0),
  description: z.string().min(1).max(500),
  incurredOn: BUSINESS_DATE.optional(),
  vendor: z.string().max(100).optional(),
  paidFrom: z.enum(["cash", "bank"]),
  bankAccountId: z.string().min(1).optional(),
});

export const approveExpenseSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const rejectExpenseSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const customerReceiptSchema = z.object({
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  amountCents: CENTS.positive(),
  method: z.enum(["cash", "cheque", "bank", "card"]),
  chequeNo: z.string().trim().max(40).optional(),
  chequeBank: z.string().trim().max(80).optional(),
  bankAccountId: z.string().min(1).optional(),
  receiptDate: BUSINESS_DATE.optional(),
  note: z.string().max(500).optional(),
});

export const voidReceiptSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const cashEntrySchema = z.object({
  branchId: z.string().min(1),
  kind: z.enum(["OWNER_CAPITAL", "OWNER_DRAWING", "STAFF_TAKE", "OTHER_INCOME", "OTHER_EXPENSE", "CASH_OVER", "CASH_SHORT"]),
  amountCents: CENTS.positive(),
  method: z.enum(["cash", "bank"]),
  /** Who took the money (owner or employee). Required for STAFF_TAKE. */
  person: z.string().min(1).max(100).optional(),
  bankAccountId: z.string().min(1).optional(),
  entryDate: BUSINESS_DATE.optional(),
  note: z.string().min(1).max(500),
});

export const taxConfigSchema = z.object({
  // Basis points: 1800 = 18%. Zero switches sales tax off.
  rateBp: z.number().int().min(0).max(5000),
  label: z.string().min(1).max(20),
  registrationNo: z.string().max(60).optional(),
});

export const taxPaymentSchema = z.object({
  branchId: z.string().min(1),
  periodFrom: BUSINESS_DATE,
  periodTo: BUSINESS_DATE,
  amountCents: CENTS.positive(),
  method: z.enum(["cash", "bank"]),
  bankAccountId: z.string().min(1).optional(),
  paidOn: BUSINESS_DATE.optional(),
  reference: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export const fiscalCloseSchema = z.object({
  yearEnd: BUSINESS_DATE,
});

export const fiscalReopenSchema = z.object({
  reason: z.string().min(1).max(500),
  approvedBy: z.string().min(1).optional(),
});

export type TaxConfigInput = z.infer<typeof taxConfigSchema>;
export type TaxPaymentInput = z.infer<typeof taxPaymentSchema>;

export type CustomerReceiptInput = z.infer<typeof customerReceiptSchema>;
export type CashEntryInput = z.infer<typeof cashEntrySchema>;

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const closeDaySchema = z.object({
  branchId: z.string().min(1),
  date: BUSINESS_DATE,
  actualCents: CENTS,
  differenceReason: z.string().max(500).optional(),
  // Note-and-coin count, LKR face value → pieces. When given it must add up
  // to actualCents, so the sheet and the total can never disagree.
  denominations: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(100000)).optional(),
  // The card terminal's end-of-day total, compared with the ledger's card sales.
  cardTerminalCents: CENTS.min(0).optional(),
  // Post the difference to 6090 Cash Short & Over so tomorrow's ledger opening
  // is what is actually in the drawer.
  postDifference: z.boolean().optional(),
});

export const reopenDaySchema = z.object({
  reason: z.string().min(1).max(500),
  approvedBy: z.string().min(1).optional(),
});

export type CloseDayInput = z.infer<typeof closeDaySchema>;
export type ReopenDayInput = z.infer<typeof reopenDaySchema>;

export const monthlyQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1970).max(2100),
  branchId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  purityId: z.string().min(1).optional(),
  staffId: z.string().min(1).optional(),
});
export type MonthlyQueryInput = z.infer<typeof monthlyQuerySchema>;
export const monthlySnapshotSchema = monthlyQuerySchema.extend({ note: z.string().max(500).optional() });

export const startCountSchema = z.object({
  branchId: z.string().min(1),
  scope: z.enum(["FULL", "CATEGORY", "BRANCH", "LOCATION"]),
  scopeRef: z.string().min(1).optional(),
});
export const scanSchema = z.object({ barcode: z.string().min(1).max(32) });
export const approveCountSchema = z.object({ reason: z.string().min(1).max(500), approvedBy: z.string().min(1).optional() });
export type StartCountInput = z.infer<typeof startCountSchema>;

export const requestTransferSchema = z.object({
  fromBranchId: z.string().min(1),
  toBranchId: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().max(500).optional(),
});
export type RequestTransferInput = z.infer<typeof requestTransferSchema>;

export const createRepairSchema = z.object({
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  itemDesc: z.string().min(1).max(500),
  weightG: z.number().gt(0).max(100000),
  conditionIn: z.string().min(1).max(1000),
  repairType: z.string().min(1).max(100),
  estimateLkr: z.number().gt(0),
});
export const repairPaymentSchema = z.object({
  method: z.enum(["cash", "card", "bank", "credit"]),
  amountLkr: z.number().gt(0),
  bankAccountId: z.string().min(1).optional(),
});
export const collectRepairSchema = z.object({
  payments: z.array(repairPaymentSchema).min(1).max(10),
  actualLkr: z.number().gt(0).optional(),
  conditionOut: z.string().min(1).max(1000),
});
export type CreateRepairInput = z.infer<typeof createRepairSchema>;
export type CollectRepairInput = z.infer<typeof collectRepairSchema>;

export const createCustomOrderSchema = z.object({
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  design: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  goldReqG: z.number().gt(0).max(100000),
  goldSource: z.enum(["CUSTOMER", "SHOP", "MIXED"]),
  quoteLkr: z.number().gt(0),
});
export const advanceCustomSchema = z.object({
  amountLkr: z.number().gt(0),
  method: z.enum(["cash", "card", "bank"]),
  bankAccountId: z.string().min(1).optional(),
});
export const sourceGoldSchema = z.object({ kind: z.enum(["CUSTOMER_OLDGOLD", "SHOP_LOT"]), refId: z.string().min(1) });
export const startProductionSchema = z.object({ manufacturingOrderId: z.string().min(1).optional() });
export const deliverCustomSchema = z.object({
  payments: z.array(z.object({ method: z.enum(["cash", "card", "bank", "credit", "other"]), amountLkr: z.number().gt(0) })).max(10),
});
export type CreateCustomOrderInput = z.infer<typeof createCustomOrderSchema>;

export const approvalActionSchema = z.enum([
  "SALES_DISCOUNT",
  "PRICE_OVERRIDE",
  "GOLD_RATE_CHANGE",
  "GOLD_STOCK_ADJUST",
  "INVENTORY_ADJUST",
  "OLDGOLD_VALUATION",
  "MELT_DIFFERENCE",
  "MFG_DIFFERENCE",
  "SALES_CANCEL",
  "PURCHASE_CANCEL",
  "SALES_RETURN",
  "FIN_ADJUST",
]);
export const requestApprovalSchema = z.object({
  action: approvalActionSchema,
  entity: z.string().min(1).max(100),
  entityId: z.string().min(1),
  oldValue: z.record(z.unknown()).optional().default({}),
  newValue: z.record(z.unknown()).optional().default({}),
  metric: z.number(),
  reason: z.string().min(1).max(500),
  branchId: z.string().min(1).optional(),
});
export const decideApprovalSchema = z.object({ reason: z.string().max(500).optional() });
