import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
  role: z.enum([
    "owner",
    "manager",
    "accountant",
    "cashier",
    "salesperson",
    "inventory_officer",
    "gold_officer",
    "manufacturing_staff",
  ]),
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
});

export const createPartySchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  nic: z.string().max(20).optional(),
  creditLimit: z.number().min(0).optional().default(0),
  openingBalance: z.number().optional().default(0),
  notes: z.string().max(2000).optional(),
  branchId: z.string().min(1),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreatePurityInput = z.infer<typeof createPuritySchema>;
export type CreateGoldRateInput = z.infer<typeof createGoldRateSchema>;
export type CreatePartyInput = z.infer<typeof createPartySchema>;

export const BARCODE_RE = /^(PRD|JW)-[A-Z0-9]{6}$/;

export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional(),
  designId: z.string().min(1).optional(),
  productTypeId: z.string().min(1).optional(),
  metalTypeId: z.string().min(1),
  stoneTypeId: z.string().min(1).optional(),
  purityId: z.string().min(1),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  makingLkr: z.number().min(0).optional().default(0),
  wastageG: z.number().min(0).optional().default(0),
  costLkr: z.number().min(0).optional(),
  sellingPriceLkr: z.number().min(0).optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  branchId: z.string().min(1),
});

export const editProductSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subcategoryId: z.string().min(1).optional(),
  designId: z.string().min(1).optional(),
  productTypeId: z.string().min(1).optional(),
  metalTypeId: z.string().min(1).optional(),
  stoneTypeId: z.string().min(1).optional(),
  makingLkr: z.number().min(0).optional(),
  wastageG: z.number().min(0).optional(),
  costLkr: z.number().min(0).optional(),
  sellingPriceLkr: z.number().min(0).optional(),
  location: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
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

export type CreateProductInput = z.infer<typeof createProductSchema>;
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

const roleEnum = z.enum([
  "owner",
  "manager",
  "accountant",
  "cashier",
  "salesperson",
  "inventory_officer",
  "gold_officer",
  "manufacturing_staff",
]);

export const editUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: roleEnum.optional(),
  branchIds: z.array(z.string().min(1)).min(1).optional(),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type EditUserInput = z.infer<typeof editUserSchema>;
