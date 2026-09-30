import { addInterval, DAY_MS, type BillingInterval } from "@goldos/shared";
import { buildPlatformAudit, fail, getPlatformSettings, type Actor } from "../core";
import { buildSubscriptionInvoice, loadPlan, loadSub, planPrice, subEventStmt, type SubRow } from "./subcore";
import { loadTenant } from "./tenants";

function audit(db: D1Database, actor: Actor, action: string, sub: SubRow, prev: unknown, next: unknown, reason: string) {
  return buildPlatformAudit(db, {
    adminId: actor.id,
    action,
    entity: "subscription",
    entityId: sub.id,
    tenantId: sub.tenant_id,
    prev,
    next,
    reason,
    ip: actor.ip,
  });
}

/**
 * Plan changes apply immediately and are not prorated: the new price bills
 * from the next renewal. A mid-period true-up, when wanted, is a manual
 * invoice — explicit, and visible on the account's statement.
 */
export async function changePlan(
  db: D1Database,
  tenantId: string,
  input: { planId: string; interval?: BillingInterval; priceCents?: number; reason: string },
  actor: Actor
): Promise<void> {
  const sub = await loadSub(db, tenantId);
  if (sub.status === "CANCELED") fail("CONFLICT", "Reactivate the subscription before changing plan");
  const plan = await loadPlan(db, input.planId);
  if (!plan.is_active) fail("VALIDATION", "That plan is archived");
  const interval = input.interval ?? sub.billing_interval;
  const price = input.priceCents ?? planPrice(plan, interval);
  if (plan.id === sub.plan_id && interval === sub.billing_interval && price === sub.price_cents)
    fail("CONFLICT", "Nothing to change");
  const after = { ...sub, plan_id: plan.id, billing_interval: interval, price_cents: price };
  const now = Date.now();
  await db.batch([
    db
      .prepare("UPDATE subscriptions SET plan_id = ?, billing_interval = ?, price_cents = ?, updated_at = ? WHERE id = ?")
      .bind(plan.id, interval, price, now, sub.id),
    subEventStmt(db, { tenantId, subscriptionId: sub.id, type: "PLAN_CHANGED", before: sub, after, reason: input.reason, actorId: actor.id, at: now }),
    audit(db, actor, "subscription.change_plan", sub,
      { plan_id: sub.plan_id, interval: sub.billing_interval, price_cents: sub.price_cents },
      { plan_id: plan.id, interval, price_cents: price }, input.reason),
  ]);
}

export async function extendTrial(db: D1Database, tenantId: string, days: number, reason: string, actor: Actor): Promise<{ trialEndsAt: number }> {
  const sub = await loadSub(db, tenantId);
  if (sub.status !== "TRIALING") fail("CONFLICT", "Only a trialing subscription can be extended");
  const from = Math.max(Date.now(), sub.trial_ends_at ?? Date.now());
  const ends = from + days * DAY_MS;
  await db.batch([
    db
      .prepare("UPDATE subscriptions SET trial_ends_at = ?, current_period_end = ?, updated_at = ? WHERE id = ?")
      .bind(ends, ends, Date.now(), sub.id),
    subEventStmt(db, { tenantId, subscriptionId: sub.id, type: "TRIAL_EXTENDED", before: sub, after: sub, reason, actorId: actor.id }),
    audit(db, actor, "subscription.extend_trial", sub, { trial_ends_at: sub.trial_ends_at }, { trial_ends_at: ends, days }, reason),
  ]);
  return { trialEndsAt: ends };
}

/** Ends a trial now and starts the first paid period (issuing its invoice). */
export async function convertTrial(db: D1Database, tenantId: string, reason: string, actor: Actor): Promise<{ invoiceNumber: string | null }> {
  const sub = await loadSub(db, tenantId);
  if (sub.status !== "TRIALING") fail("CONFLICT", "Subscription is not trialing");
  return startPaidPeriod(db, sub, "TRIAL_CONVERTED", reason, actor);
}

async function startPaidPeriod(db: D1Database, sub: SubRow, eventType: string, reason: string, actor: Actor): Promise<{ invoiceNumber: string | null }> {
  const tenant = await loadTenant(db, sub.tenant_id);
  const plan = await loadPlan(db, sub.plan_id);
  const settings = await getPlatformSettings(db);
  const now = Date.now();
  const end = addInterval(now, sub.billing_interval);
  const after = { ...sub, status: "ACTIVE", current_period_start: now, current_period_end: end, trial_ends_at: null, cancel_at_period_end: 0 };
  const invoice = await buildSubscriptionInvoice(db, {
    sub, planName: plan.name, currency: tenant.currency, periodStart: now, periodEnd: end, settings, actorId: actor.id, now,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE subscriptions SET status = 'ACTIVE', current_period_start = ?, current_period_end = ?, trial_ends_at = NULL,
           cancel_at_period_end = 0, canceled_at = NULL, cancel_reason = NULL, past_due_since = NULL, updated_at = ? WHERE id = ?`
      )
      .bind(now, end, now, sub.id),
    subEventStmt(db, { tenantId: sub.tenant_id, subscriptionId: sub.id, type: eventType, before: sub, after, reason, actorId: actor.id, at: now }),
    ...(invoice?.stmts ?? []),
    audit(db, actor, `subscription.${eventType.toLowerCase()}`, sub, { status: sub.status }, { status: "ACTIVE", invoice: invoice?.number ?? null }, reason),
  ]);
  return { invoiceNumber: invoice?.number ?? null };
}

export async function cancelSubscription(
  db: D1Database,
  tenantId: string,
  atPeriodEnd: boolean,
  reason: string,
  actor: Actor
): Promise<void> {
  const sub = await loadSub(db, tenantId);
  if (sub.status === "CANCELED") fail("CONFLICT", "Subscription is already cancelled");
  const now = Date.now();
  if (atPeriodEnd) {
    if (sub.cancel_at_period_end) fail("CONFLICT", "Cancellation is already scheduled");
    await db.batch([
      db
        .prepare("UPDATE subscriptions SET cancel_at_period_end = 1, cancel_reason = ?, updated_at = ? WHERE id = ?")
        .bind(reason, now, sub.id),
      subEventStmt(db, { tenantId, subscriptionId: sub.id, type: "CANCEL_SCHEDULED", before: sub, after: sub, reason, actorId: actor.id, at: now }),
      audit(db, actor, "subscription.cancel_scheduled", sub, { cancel_at_period_end: 0 }, { cancel_at_period_end: 1 }, reason),
    ]);
    return;
  }
  const after = { ...sub, status: "CANCELED" };
  await db.batch([
    db
      .prepare("UPDATE subscriptions SET status = 'CANCELED', canceled_at = ?, cancel_reason = ?, cancel_at_period_end = 0, past_due_since = NULL, updated_at = ? WHERE id = ?")
      .bind(now, reason, now, sub.id),
    subEventStmt(db, { tenantId, subscriptionId: sub.id, type: "CANCELED", before: sub, after, reason, actorId: actor.id, at: now }),
    audit(db, actor, "subscription.cancel", sub, { status: sub.status }, { status: "CANCELED" }, reason),
  ]);
}

export async function resumeSubscription(db: D1Database, tenantId: string, reason: string, actor: Actor): Promise<void> {
  const sub = await loadSub(db, tenantId);
  if (!sub.cancel_at_period_end || sub.status === "CANCELED") fail("CONFLICT", "No scheduled cancellation to undo");
  await db.batch([
    db.prepare("UPDATE subscriptions SET cancel_at_period_end = 0, cancel_reason = NULL, updated_at = ? WHERE id = ?").bind(Date.now(), sub.id),
    subEventStmt(db, { tenantId, subscriptionId: sub.id, type: "CANCEL_UNDONE", before: sub, after: sub, reason, actorId: actor.id }),
    audit(db, actor, "subscription.resume", sub, { cancel_at_period_end: 1 }, { cancel_at_period_end: 0 }, reason),
  ]);
}

export async function reactivateSubscription(db: D1Database, tenantId: string, reason: string, actor: Actor): Promise<{ invoiceNumber: string | null }> {
  const sub = await loadSub(db, tenantId);
  if (sub.status !== "CANCELED") fail("CONFLICT", "Subscription is not cancelled");
  const tenant = await loadTenant(db, tenantId);
  if (tenant.status === "ARCHIVED") fail("CONFLICT", "Restore the account before reactivating");
  return startPaidPeriod(db, sub, "REACTIVATED", reason, actor);
}

export async function applyDiscount(
  db: D1Database,
  tenantId: string,
  input: { couponCode?: string; percentOff?: number; months?: number | null; reason: string },
  actor: Actor
): Promise<void> {
  const sub = await loadSub(db, tenantId);
  if (sub.status === "CANCELED") fail("CONFLICT", "Subscription is cancelled");
  const now = Date.now();
  let pct: number;
  let months: number | null;
  let couponId: string | null = null;
  const stmts: D1PreparedStatement[] = [];
  if (input.couponCode) {
    const c = await db
      .prepare("SELECT * FROM coupons WHERE code = ?")
      .bind(input.couponCode.toUpperCase())
      .first<{ id: string; percent_off: number; duration_months: number | null; max_redemptions: number | null; redeemed_count: number; expires_at: number | null; is_active: number }>();
    if (!c || !c.is_active) fail("NOT_FOUND", "Coupon not found or inactive");
    if (c.expires_at && c.expires_at < now) fail("CONFLICT", "Coupon has expired");
    if (c.max_redemptions !== null && c.redeemed_count >= c.max_redemptions) fail("CONFLICT", "Coupon is fully redeemed");
    pct = c.percent_off;
    months = c.duration_months;
    couponId = c.id;
    // Guarded so a race between two redemptions cannot push the count past the cap.
    stmts.push(
      db
        .prepare("UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = ? AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)")
        .bind(c.id)
    );
  } else if (input.percentOff !== undefined) {
    pct = input.percentOff;
    months = input.months ?? null;
  } else {
    fail("VALIDATION", "Give a coupon code or a percentage");
  }
  const endsAt = months ? addInterval(now, "MONTH", months) : null;
  const after = { ...sub, discount_pct: pct };
  await db.batch([
    ...stmts,
    db
      .prepare("UPDATE subscriptions SET discount_pct = ?, coupon_id = ?, discount_ends_at = ?, updated_at = ? WHERE id = ?")
      .bind(pct, couponId, endsAt, now, sub.id),
    subEventStmt(db, { tenantId, subscriptionId: sub.id, type: pct === 0 ? "DISCOUNT_REMOVED" : "DISCOUNT_APPLIED", before: sub, after, reason: input.reason, actorId: actor.id, at: now }),
    audit(db, actor, "subscription.discount", sub,
      { discount_pct: sub.discount_pct, coupon_id: sub.coupon_id, discount_ends_at: sub.discount_ends_at },
      { discount_pct: pct, coupon_id: couponId, discount_ends_at: endsAt }, input.reason),
  ]);
}
