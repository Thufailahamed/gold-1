import { z } from "zod";

/* ------------------------------------------------------------------ RBAC */

/**
 * Platform (control-plane) permissions. These gate the SaaS operator's staff,
 * never a shop's users â€” a shop's `users:*` vocabulary lives in permissions.ts
 * and the two sets never mix: a platform admin is not a row in any tenant's
 * `users` table.
 */
export const PLATFORM_PERMISSIONS = {
  TENANTS_VIEW: "p.tenants:view",
  TENANTS_MANAGE: "p.tenants:manage",
  TENANTS_SUSPEND: "p.tenants:suspend",
  TENANTS_DELETE: "p.tenants:delete",
  TENANTS_IMPERSONATE: "p.tenants:impersonate",
  BILLING_VIEW: "p.billing:view",
  BILLING_MANAGE: "p.billing:manage",
  PLANS_MANAGE: "p.plans:manage",
  FLAGS_MANAGE: "p.flags:manage",
  ANNOUNCEMENTS_MANAGE: "p.announcements:manage",
  SUPPORT_VIEW: "p.support:view",
  SUPPORT_MANAGE: "p.support:manage",
  ADMINS_VIEW: "p.admins:view",
  ADMINS_MANAGE: "p.admins:manage",
  AUDIT_VIEW: "p.audit:view",
  SYSTEM_VIEW: "p.system:view",
  SETTINGS_MANAGE: "p.settings:manage",
} as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

const P = PLATFORM_PERMISSIONS;
const ALL_PLATFORM = Object.values(P);

/** Fixed staff roles. Code checks permissions, never role names. */
export const PLATFORM_ROLES = {
  super_admin: {
    label: "Super admin",
    description: "Everything, including staff management and platform settings.",
    permissions: ALL_PLATFORM,
  },
  operations: {
    label: "Operations",
    description: "Runs accounts day to day: provisioning, plans, flags, announcements.",
    permissions: [
      P.TENANTS_VIEW, P.TENANTS_MANAGE, P.TENANTS_SUSPEND, P.TENANTS_IMPERSONATE,
      P.BILLING_VIEW, P.PLANS_MANAGE, P.FLAGS_MANAGE, P.ANNOUNCEMENTS_MANAGE,
      P.SUPPORT_VIEW, P.SUPPORT_MANAGE, P.ADMINS_VIEW, P.AUDIT_VIEW, P.SYSTEM_VIEW,
    ],
  },
  billing: {
    label: "Billing",
    description: "Invoices, payments, coupons and subscription changes.",
    permissions: [P.TENANTS_VIEW, P.BILLING_VIEW, P.BILLING_MANAGE, P.SUPPORT_VIEW, P.AUDIT_VIEW],
  },
  support: {
    label: "Support",
    description: "Works the ticket queue and can sign in as a shop to reproduce issues.",
    permissions: [P.TENANTS_VIEW, P.TENANTS_IMPERSONATE, P.BILLING_VIEW, P.SUPPORT_VIEW, P.SUPPORT_MANAGE],
  },
  analyst: {
    label: "Analyst",
    description: "Read-only access to accounts, revenue and audit.",
    permissions: [P.TENANTS_VIEW, P.BILLING_VIEW, P.SUPPORT_VIEW, P.AUDIT_VIEW, P.SYSTEM_VIEW],
  },
} as const satisfies Record<string, { label: string; description: string; permissions: readonly string[] }>;

export type PlatformRole = keyof typeof PLATFORM_ROLES;
export const PLATFORM_ROLE_KEYS = Object.keys(PLATFORM_ROLES) as PlatformRole[];

export function platformPermissionsFor(role: string): string[] {
  const r = (PLATFORM_ROLES as Record<string, { permissions: readonly string[] }>)[role];
  return r ? [...r.permissions] : [];
}

/* ------------------------------------------------------------------ Enums */

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_INTERVALS = ["MONTH", "YEAR"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const INVOICE_STATUSES = ["OPEN", "PAID", "VOID", "UNCOLLECTIBLE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["BANK", "CARD", "CASH", "ONLINE", "OTHER"] as const;

export const TICKET_STATUSES = ["OPEN", "PENDING", "RESOLVED", "CLOSED"] as const;
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const ANNOUNCEMENT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export const ANNOUNCEMENT_AUDIENCES = ["ALL", "PLAN", "TENANT"] as const;

/** Limits a plan meters. `null` on a plan means unlimited. */
export const PLAN_LIMIT_KEYS = ["maxUsers", "maxBranches", "maxProducts", "maxStorageMb"] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

/* ------------------------------------------------------------------ Schemas */

const slug = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Lowercase letters, digits and dashes");

const limit = z.number().int().min(0).nullable();
const cents = z.number().int().min(0);
const reason = z.string().trim().min(3).max(500);

export const platformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const platformMfaSchema = z.object({ code: z.string().regex(/^\d{6}$/, "6-digit code") });

export const platformBootstrapSchema = z.object({
  token: z.string().min(16),
  email: z.string().email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12),
});

export const createPlatformAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12),
  role: z.enum(PLATFORM_ROLE_KEYS as [PlatformRole, ...PlatformRole[]]),
});

export const editPlatformAdminSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(PLATFORM_ROLE_KEYS as [PlatformRole, ...PlatformRole[]]).optional(),
});

export const platformPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
  legalName: z.string().trim().max(200).optional(),
  ownerName: z.string().trim().min(1).max(100),
  ownerEmail: z.string().email(),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().length(2).default("LK"),
  currency: z.string().trim().length(3).default("LKR"),
  timezone: z.string().trim().max(60).default("Asia/Colombo"),
  region: z.string().trim().max(40).default("apac"),
  planId: z.string().min(1),
  interval: z.enum(BILLING_INTERVALS).default("MONTH"),
  /** Overrides the plan's trial length. 0 starts paid immediately. */
  trialDays: z.number().int().min(0).max(365).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});

export const editTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  ownerName: z.string().trim().min(1).max(100).optional(),
  ownerEmail: z.string().email().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().length(2).optional(),
  timezone: z.string().trim().max(60).optional(),
  region: z.string().trim().max(40).optional(),
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Invalid domain")
    .nullable()
    .optional(),
  dataPlane: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
});

export const platformReasonSchema = z.object({ reason });

export const changePlanSchema = z.object({
  planId: z.string().min(1),
  interval: z.enum(BILLING_INTERVALS).optional(),
  /** Price override per interval, in cents. Omit to take the plan's list price. */
  priceCents: cents.optional(),
  reason,
});

export const extendTrialSchema = z.object({ days: z.number().int().min(1).max(180), reason });

export const cancelSubscriptionSchema = z.object({
  /** false cancels immediately; true lets the paid period run out. */
  atPeriodEnd: z.boolean().default(true),
  reason,
});

export const applyDiscountSchema = z.object({
  couponCode: z.string().trim().min(1).max(40).optional(),
  percentOff: z.number().int().min(0).max(100).optional(),
  months: z.number().int().min(1).max(60).nullable().optional(),
  reason,
});

export const planSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).default(""),
  priceMonthlyCents: cents,
  priceYearlyCents: cents,
  currency: z.string().trim().length(3).default("LKR"),
  trialDays: z.number().int().min(0).max(365).default(14),
  maxUsers: limit,
  maxBranches: limit,
  maxProducts: limit,
  maxStorageMb: limit,
  features: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const editPlanSchema = planSchema.omit({ code: true }).partial().extend({
  isActive: z.boolean().optional(),
});

export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/),
  description: z.string().trim().max(200).default(""),
  percentOff: z.number().int().min(1).max(100),
  /** null = forever. */
  durationMonths: z.number().int().min(1).max(60).nullable(),
  maxRedemptions: z.number().int().min(1).nullable().default(null),
  expiresAt: z.number().int().positive().nullable().default(null),
});

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  receivedAt: z.number().int().positive().optional(),
});

export const manualInvoiceSchema = z.object({
  tenantId: z.string().min(1),
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
  dueDays: z.number().int().min(0).max(120).default(7),
  memo: z.string().trim().max(500).optional(),
});

export const flagSchema = z.object({
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9_.-]+$/),
  description: z.string().trim().max(300).default(""),
  defaultEnabled: z.boolean().default(false),
  rolloutPct: z.number().int().min(0).max(100).default(0),
});

export const editFlagSchema = flagSchema.omit({ key: true }).partial();

export const flagOverrideSchema = z.object({
  flagKey: z.string().min(1),
  /** null clears the override. */
  enabled: z.boolean().nullable(),
});

export const announcementSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    severity: z.enum(ANNOUNCEMENT_SEVERITIES).default("INFO"),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).default("ALL"),
    audienceRef: z.string().trim().max(60).nullable().default(null),
    startsAt: z.number().int().positive().nullable().default(null),
    endsAt: z.number().int().positive().nullable().default(null),
  })
  .refine((a) => a.audience === "ALL" || !!a.audienceRef, {
    message: "Audience target is required",
    path: ["audienceRef"],
  })
  .refine((a) => !a.startsAt || !a.endsAt || a.endsAt > a.startsAt, {
    message: "End must be after start",
    path: ["endsAt"],
  });

export const createTicketSchema = z.object({
  tenantId: z.string().min(1),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10000),
  priority: z.enum(TICKET_PRIORITIES).default("NORMAL"),
  category: z.string().trim().max(40).default("general"),
  requesterEmail: z.string().email().optional(),
});

export const tenantTicketSchema = createTicketSchema.omit({ tenantId: true, requesterEmail: true });

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1).max(10000),
  internal: z.boolean().default(false),
});

export const editTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

export const tenantNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  pinned: z.boolean().default(false),
});

export const impersonateSchema = z.object({
  targetEmail: z.string().email().optional(),
  reason,
});

/** Platform settings the portal edits. Every key has a default, so reads never miss. */
export const PLATFORM_SETTING_DEFAULTS = {
  company_name: "GoldOS",
  support_email: "support@goldos.lk",
  default_currency: "LKR",
  default_trial_days: 14,
  invoice_prefix: "INV",
  invoice_due_days: 7,
  tax_rate_bps: 0,
  tax_label: "VAT",
  past_due_grace_days: 14,
  auto_suspend_past_due: true,
  signup_enabled: false,
  maintenance_mode: false,
  maintenance_message: "",
  impersonation_ttl_minutes: 10,
} as const;

export type PlatformSettings = { -readonly [K in keyof typeof PLATFORM_SETTING_DEFAULTS]: (typeof PLATFORM_SETTING_DEFAULTS)[K] extends boolean ? boolean : (typeof PLATFORM_SETTING_DEFAULTS)[K] extends number ? number : string };

export const platformSettingsSchema = z
  .object({
    company_name: z.string().trim().min(1).max(80),
    support_email: z.string().email(),
    default_currency: z.string().trim().length(3),
    default_trial_days: z.number().int().min(0).max(365),
    invoice_prefix: z.string().trim().min(1).max(8).regex(/^[A-Z0-9]+$/),
    invoice_due_days: z.number().int().min(0).max(120),
    tax_rate_bps: z.number().int().min(0).max(5000),
    tax_label: z.string().trim().min(1).max(20),
    past_due_grace_days: z.number().int().min(0).max(120),
    auto_suspend_past_due: z.boolean(),
    signup_enabled: z.boolean(),
    maintenance_mode: z.boolean(),
    maintenance_message: z.string().trim().max(300),
    impersonation_ttl_minutes: z.number().int().min(1).max(60),
  })
  .partial();

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type EditTenantInput = z.infer<typeof editTenantSchema>;
export type PlanInput = z.infer<typeof planSchema>;
export type EditPlanInput = z.infer<typeof editPlanSchema>;
export type CouponInput = z.infer<typeof couponSchema>;
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/* ------------------------------------------------------------------ Billing maths */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Advances a timestamp by one billing interval in calendar terms (UTC), so a
 * subscription started on the 31st renews on the last day of shorter months
 * instead of drifting into the next month.
 */
export function addInterval(at: number, interval: BillingInterval, count = 1): number {
  const d = new Date(at);
  const months = interval === "YEAR" ? 12 * count : count;
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}

export type MrrInput = {
  status: SubscriptionStatus | string;
  interval: BillingInterval | string;
  priceCents: number;
  discountPct: number;
};

/**
 * Monthly recurring revenue one subscription contributes, after discount.
 * Trials and cancelled subscriptions contribute nothing; past-due still counts
 * because the revenue is contracted, just not collected â€” dropping it would
 * make a collections problem look like churn.
 */
export function monthlyValueCents(s: MrrInput): number {
  if (s.status !== "ACTIVE" && s.status !== "PAST_DUE") return 0;
  const net = discounted(s.priceCents, s.discountPct);
  return s.interval === "YEAR" ? Math.round(net / 12) : net;
}

export function discounted(priceCents: number, discountPct: number): number {
  const pct = Math.max(0, Math.min(100, discountPct));
  return priceCents - Math.round((priceCents * pct) / 100);
}

/** Invoice totals for one period. Tax applies after the discount. */
export function invoiceAmounts(priceCents: number, discountPct: number, taxBps: number) {
  const subtotal = priceCents;
  const discount = priceCents - discounted(priceCents, discountPct);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * Math.max(0, taxBps)) / 10000);
  return { subtotalCents: subtotal, discountCents: discount, taxCents: tax, totalCents: taxable + tax };
}

/** Classifies an MRR change for the movement report. */
export function mrrMovement(beforeCents: number, afterCents: number): "new" | "expansion" | "contraction" | "churn" | "none" {
  if (beforeCents === afterCents) return "none";
  if (beforeCents === 0) return "new";
  if (afterCents === 0) return "churn";
  return afterCents > beforeCents ? "expansion" : "contraction";
}

/* ------------------------------------------------------------------ Feature flags */

/** Stable 0â€“99 bucket for a (tenant, flag) pair â€” FNV-1a, so a rollout never flickers. */
export function rolloutBucket(tenantId: string, flagKey: string): number {
  let h = 0x811c9dc5;
  const s = `${flagKey}:${tenantId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

export type FlagDef = { key: string; defaultEnabled: boolean; rolloutPct: number };

/**
 * Precedence: an explicit tenant override wins, then the plan's entitlement,
 * then the percentage rollout, then the flag's default.
 */
export function evaluateFlag(
  flag: FlagDef,
  ctx: { tenantId: string; planFeatures: readonly string[]; override?: boolean | null }
): { enabled: boolean; source: "override" | "plan" | "rollout" | "default" } {
  if (ctx.override === true || ctx.override === false) return { enabled: ctx.override, source: "override" };
  if (ctx.planFeatures.includes(flag.key)) return { enabled: true, source: "plan" };
  if (flag.rolloutPct > 0 && rolloutBucket(ctx.tenantId, flag.key) < flag.rolloutPct)
    return { enabled: true, source: "rollout" };
  return { enabled: flag.defaultEnabled, source: "default" };
}

/* ------------------------------------------------------------------ Lifecycle */

export type SubscriptionClock = {
  status: SubscriptionStatus | string;
  trialEndsAt: number | null;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
};

/**
 * What the billing cycle must do with one subscription right now. Pure, so
 * the cron and the "run billing now" button share one tested decision.
 */
export function nextLifecycleAction(s: SubscriptionClock, now: number): "none" | "end_trial" | "renew" | "cancel" {
  if (s.status === "CANCELED") return "none";
  if (s.status === "TRIALING") {
    if (s.trialEndsAt !== null && s.trialEndsAt <= now) return s.cancelAtPeriodEnd ? "cancel" : "end_trial";
    return "none";
  }
  if (s.currentPeriodEnd <= now) return s.cancelAtPeriodEnd ? "cancel" : "renew";
  return "none";
}

/** A usage figure against a plan limit. `null` limit = unlimited. */
export function limitStatus(used: number, max: number | null): { pct: number | null; over: boolean; near: boolean } {
  if (max === null) return { pct: null, over: false, near: false };
  if (max === 0) return { pct: used > 0 ? 100 : 0, over: used > 0, near: false };
  const pct = Math.round((used / max) * 100);
  return { pct, over: used >= max, near: pct >= 80 && used < max };
}

/* ------------------------------------------------------------------ TOTP */

/** RFC 4648 base32 (no padding) â€” the encoding authenticator apps expect. */
export function base32Encode(bytes: Uint8Array): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = A.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** RFC 6238 TOTP (SHA-1, 30s step, 6 digits) via WebCrypto â€” runs in Workers and Node. */
export async function totpCode(secretB32: string, at: number, step = 30): Promise<string> {
  const counter = Math.floor(at / 1000 / step);
  const msg = new Uint8Array(new ArrayBuffer(8));
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretB32),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Accepts the current step and one either side, for clock drift. */
export async function verifyTotp(secretB32: string, code: string, at: number): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  for (const drift of [-30_000, 0, 30_000]) {
    if ((await totpCode(secretB32, at + drift)) === code) return true;
  }
  return false;
}
