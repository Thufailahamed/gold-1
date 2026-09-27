import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
  role: z.enum(["admin", "manager", "cashier", "viewer"]),
  branchId: z.string().min(1),
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
  purity: z.number().gt(0).lte(1),
  defaultMakingCharge: z.number().min(0).optional().default(0),
  defaultWastagePct: z.number().min(0).max(100).optional().default(0),
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
  branchId: z.string().min(1),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreatePurityInput = z.infer<typeof createPuritySchema>;
export type CreateGoldRateInput = z.infer<typeof createGoldRateSchema>;
export type CreatePartyInput = z.infer<typeof createPartySchema>;

export const BARCODE_RE = /^PRD-[A-Z0-9]{6}$/;

export const createProductSchema = z.object({
  name: z.string().min(1).max(100),
  categoryId: z.string().min(1),
  purityId: z.string().min(1),
  grossWeight: z.number().gt(0).max(100000),
  stoneWeight: z.number().min(0).max(100000).optional().default(0),
  makingCharge: z.number().min(0).optional().default(0),
  branchId: z.string().min(1),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
