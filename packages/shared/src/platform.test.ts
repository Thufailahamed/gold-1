import { describe, expect, it } from "vitest";
import {
  addInterval,
  announcementSchema,
  base32Decode,
  base32Encode,
  createTenantSchema,
  evaluateFlag,
  invoiceAmounts,
  limitStatus,
  monthlyValueCents,
  mrrMovement,
  nextLifecycleAction,
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  platformPermissionsFor,
  rolloutBucket,
  totpCode,
  verifyTotp,
} from "./platform";

describe("platform roles", () => {
  it("super_admin holds every platform permission", () => {
    expect(new Set(platformPermissionsFor("super_admin"))).toEqual(new Set(Object.values(PLATFORM_PERMISSIONS)));
  });
  it("only super_admin can manage staff or settings", () => {
    for (const [key, role] of Object.entries(PLATFORM_ROLES)) {
      if (key === "super_admin") continue;
      expect(role.permissions).not.toContain(PLATFORM_PERMISSIONS.ADMINS_MANAGE);
      expect(role.permissions).not.toContain(PLATFORM_PERMISSIONS.SETTINGS_MANAGE);
    }
  });
  it("analyst is read-only", () => {
    expect(platformPermissionsFor("analyst").every((p) => p.endsWith(":view"))).toBe(true);
  });
  it("unknown roles get nothing", () => {
    expect(platformPermissionsFor("owner")).toEqual([]);
  });
});

describe("addInterval", () => {
  it("adds a calendar month", () => {
    expect(new Date(addInterval(Date.UTC(2026, 0, 15), "MONTH")).toISOString()).toBe("2026-02-15T00:00:00.000Z");
  });
  it("clamps the 31st to the end of a short month", () => {
    expect(new Date(addInterval(Date.UTC(2026, 0, 31), "MONTH")).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
  it("handles leap years on yearly renewals", () => {
    expect(new Date(addInterval(Date.UTC(2028, 1, 29), "YEAR")).toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
  it("rolls over December", () => {
    expect(new Date(addInterval(Date.UTC(2026, 11, 10), "MONTH")).toISOString()).toBe("2027-01-10T00:00:00.000Z");
  });
});

describe("MRR", () => {
  it("excludes trials and cancellations", () => {
    expect(monthlyValueCents({ status: "TRIALING", interval: "MONTH", priceCents: 1000, discountPct: 0 })).toBe(0);
    expect(monthlyValueCents({ status: "CANCELED", interval: "MONTH", priceCents: 1000, discountPct: 0 })).toBe(0);
  });
  it("keeps past-due revenue", () => {
    expect(monthlyValueCents({ status: "PAST_DUE", interval: "MONTH", priceCents: 1000, discountPct: 0 })).toBe(1000);
  });
  it("normalises yearly plans and applies discounts", () => {
    expect(monthlyValueCents({ status: "ACTIVE", interval: "YEAR", priceCents: 120000, discountPct: 0 })).toBe(10000);
    expect(monthlyValueCents({ status: "ACTIVE", interval: "MONTH", priceCents: 10000, discountPct: 25 })).toBe(7500);
  });
  it("classifies movements", () => {
    expect(mrrMovement(0, 500)).toBe("new");
    expect(mrrMovement(500, 0)).toBe("churn");
    expect(mrrMovement(500, 900)).toBe("expansion");
    expect(mrrMovement(900, 500)).toBe("contraction");
    expect(mrrMovement(500, 500)).toBe("none");
  });
});

describe("invoiceAmounts", () => {
  it("taxes the discounted amount", () => {
    expect(invoiceAmounts(10000, 10, 1800)).toEqual({
      subtotalCents: 10000,
      discountCents: 1000,
      taxCents: 1620,
      totalCents: 10620,
    });
  });
  it("is zero-safe", () => {
    expect(invoiceAmounts(0, 50, 1800).totalCents).toBe(0);
  });
});

describe("feature flags", () => {
  const flag = { key: "analytics", defaultEnabled: false, rolloutPct: 0 };
  it("override beats everything", () => {
    expect(evaluateFlag(flag, { tenantId: "t", planFeatures: ["analytics"], override: false })).toEqual({ enabled: false, source: "override" });
  });
  it("plan entitlement enables", () => {
    expect(evaluateFlag(flag, { tenantId: "t", planFeatures: ["analytics"] }).source).toBe("plan");
  });
  it("falls back to default", () => {
    expect(evaluateFlag({ ...flag, defaultEnabled: true }, { tenantId: "t", planFeatures: [] })).toEqual({ enabled: true, source: "default" });
  });
  it("rollout buckets are stable and roughly proportional", () => {
    expect(rolloutBucket("t1", "x")).toBe(rolloutBucket("t1", "x"));
    let on = 0;
    for (let i = 0; i < 2000; i++) {
      if (evaluateFlag({ key: "beta", defaultEnabled: false, rolloutPct: 30 }, { tenantId: `tenant-${i}`, planFeatures: [] }).enabled) on++;
    }
    expect(on / 2000).toBeGreaterThan(0.25);
    expect(on / 2000).toBeLessThan(0.35);
  });
  it("100% rollout enables everyone", () => {
    expect(evaluateFlag({ key: "k", defaultEnabled: false, rolloutPct: 100 }, { tenantId: "zz", planFeatures: [] }).enabled).toBe(true);
  });
});

describe("nextLifecycleAction", () => {
  const base = { trialEndsAt: null, currentPeriodEnd: 1000, cancelAtPeriodEnd: false };
  it("ends an expired trial", () => {
    expect(nextLifecycleAction({ ...base, status: "TRIALING", trialEndsAt: 500 }, 600)).toBe("end_trial");
  });
  it("cancels a trial marked to cancel", () => {
    expect(nextLifecycleAction({ ...base, status: "TRIALING", trialEndsAt: 500, cancelAtPeriodEnd: true }, 600)).toBe("cancel");
  });
  it("renews at period end", () => {
    expect(nextLifecycleAction({ ...base, status: "ACTIVE" }, 1000)).toBe("renew");
    expect(nextLifecycleAction({ ...base, status: "PAST_DUE" }, 1001)).toBe("renew");
  });
  it("cancels at period end when asked", () => {
    expect(nextLifecycleAction({ ...base, status: "ACTIVE", cancelAtPeriodEnd: true }, 1001)).toBe("cancel");
  });
  it("leaves running and cancelled subscriptions alone", () => {
    expect(nextLifecycleAction({ ...base, status: "ACTIVE" }, 999)).toBe("none");
    expect(nextLifecycleAction({ ...base, status: "CANCELED" }, 5000)).toBe("none");
  });
});

describe("limitStatus", () => {
  it("treats null as unlimited", () => {
    expect(limitStatus(1_000_000, null)).toEqual({ pct: null, over: false, near: false });
  });
  it("flags near and over", () => {
    expect(limitStatus(8, 10)).toEqual({ pct: 80, over: false, near: true });
    expect(limitStatus(10, 10).over).toBe(true);
  });
});

describe("TOTP", () => {
  // RFC 6238 appendix B, SHA-1 seed "12345678901234567890".
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  it("round-trips base32", () => {
    expect(new TextDecoder().decode(base32Decode(secret))).toBe("12345678901234567890");
  });
  it("matches the RFC test vectors (last 6 digits)", async () => {
    expect(await totpCode(secret, 59_000)).toBe("287082");
    expect(await totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(await totpCode(secret, 1_234_567_890_000)).toBe("005924");
  });
  it("tolerates one step of drift and rejects garbage", async () => {
    const code = await totpCode(secret, 1_234_567_890_000);
    expect(await verifyTotp(secret, code, 1_234_567_890_000 + 30_000)).toBe(true);
    expect(await verifyTotp(secret, code, 1_234_567_890_000 + 120_000)).toBe(false);
    expect(await verifyTotp(secret, "abc123", 0)).toBe(false);
  });
});

describe("schemas", () => {
  it("rejects bad slugs", () => {
    const base = { name: "Shop", ownerName: "A", ownerEmail: "a@b.co", planId: "p" };
    expect(createTenantSchema.safeParse({ ...base, slug: "Bad Slug" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, slug: "-x-" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, slug: "kandy-gold" }).success).toBe(true);
  });
  it("requires a target for non-global announcements", () => {
    expect(announcementSchema.safeParse({ title: "t", body: "b", audience: "TENANT" }).success).toBe(false);
    expect(announcementSchema.safeParse({ title: "t", body: "b", audience: "ALL" }).success).toBe(true);
  });
});
