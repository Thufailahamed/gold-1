import { invoiceAmounts, monthlyValueCents, type PlatformSettings } from "@goldos/shared";
import { fail, nextNumber } from "../core";

export type SubRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  billing_interval: "MONTH" | "YEAR";
  price_cents: number;
  discount_pct: number;
  coupon_id: string | null;
  discount_ends_at: number | null;
  trial_ends_at: number | null;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: number;
  canceled_at: number | null;
  cancel_reason: string | null;
  past_due_since: number | null;
  created_at: number;
  updated_at: number;
};

export type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  currency: string;
  trial_days: number;
  max_users: number | null;
  max_branches: number | null;
  max_products: number | null;
  max_storage_mb: number | null;
  features_json: string;
  is_public: number;
  is_active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export async function loadSub(db: D1Database, tenantId: string): Promise<SubRow> {
  const s = await db.prepare("SELECT * FROM subscriptions WHERE tenant_id = ?").bind(tenantId).first<SubRow>();
  if (!s) fail("NOT_FOUND", "Subscription not found");
  return s;
}

export async function loadPlan(db: D1Database, planId: string): Promise<PlanRow> {
  const p = await db.prepare("SELECT * FROM plans WHERE id = ?").bind(planId).first<PlanRow>();
  if (!p) fail("NOT_FOUND", "Plan not found");
  return p;
}

export function planPrice(plan: PlanRow, interval: "MONTH" | "YEAR"): number {
  return interval === "YEAR" ? plan.price_yearly_cents : plan.price_monthly_cents;
}

export type SubState = Pick<SubRow, "plan_id" | "status" | "billing_interval" | "price_cents" | "discount_pct">;

export const mrrOf = (s: SubState): number =>
  monthlyValueCents({ status: s.status, interval: s.billing_interval, priceCents: s.price_cents, discountPct: s.discount_pct });

/**
 * Append-only history row. The before/after MRR is captured on every change,
 * so the revenue trend is a running sum of deltas — no nightly snapshot job
 * to forget, and no drift between the chart and the subscriptions table.
 */
export function subEventStmt(
  db: D1Database,
  args: {
    tenantId: string;
    subscriptionId: string;
    type: string;
    before: SubState | null;
    after: SubState;
    reason?: string | null;
    actorId: string | null;
    at?: number;
  }
): D1PreparedStatement {
  const before = args.before ? mrrOf(args.before) : 0;
  const after = mrrOf(args.after);
  return db
    .prepare(
      `INSERT INTO subscription_events (id, tenant_id, subscription_id, type, from_plan_id, to_plan_id, from_status, to_status,
        mrr_before_cents, mrr_after_cents, mrr_delta_cents, reason, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      args.tenantId,
      args.subscriptionId,
      args.type,
      args.before?.plan_id ?? null,
      args.after.plan_id,
      args.before?.status ?? null,
      args.after.status,
      before,
      after,
      after - before,
      args.reason ?? null,
      args.at ?? Date.now(),
      args.actorId
    );
}

/**
 * Builds (does not run) the statements for one subscription period's invoice.
 * The invoice number is reserved here, outside the caller's batch. A zero
 * total returns null: free plans do not get paper invoices.
 */
export async function buildSubscriptionInvoice(
  db: D1Database,
  args: {
    sub: Pick<SubRow, "id" | "tenant_id" | "billing_interval" | "price_cents" | "discount_pct">;
    planName: string;
    currency: string;
    periodStart: number;
    periodEnd: number;
    settings: PlatformSettings;
    actorId: string | null;
    now?: number;
  }
): Promise<{ invoiceId: string; number: string; totalCents: number; stmts: D1PreparedStatement[] } | null> {
  const amounts = invoiceAmounts(args.sub.price_cents, args.sub.discount_pct, args.settings.tax_rate_bps);
  if (amounts.totalCents <= 0) return null;
  const now = args.now ?? Date.now();
  const invoiceId = crypto.randomUUID();
  const number = await nextNumber(db, "INV", args.settings.invoice_prefix);
  const dueAt = now + args.settings.invoice_due_days * 24 * 60 * 60 * 1000;
  const label = `${args.planName} plan — ${args.sub.billing_interval === "YEAR" ? "annual" : "monthly"} subscription`;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO invoices (id, number, tenant_id, subscription_id, kind, period_start, period_end, currency, subtotal_cents, discount_cents,
          tax_cents, total_cents, amount_paid_cents, status, issued_at, due_at, created_at, created_by)
         VALUES (?, ?, ?, ?, 'SUBSCRIPTION', ?, ?, ?, ?, ?, ?, ?, 0, 'OPEN', ?, ?, ?, ?)`
      )
      .bind(
        invoiceId, number, args.sub.tenant_id, args.sub.id, args.periodStart, args.periodEnd, args.currency,
        amounts.subtotalCents, amounts.discountCents, amounts.taxCents, amounts.totalCents, now, dueAt, now, args.actorId
      ),
    db
      .prepare("INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES (?, ?, ?, 1, ?, ?)")
      .bind(crypto.randomUUID(), invoiceId, label, args.sub.price_cents, args.sub.price_cents),
  ];
  if (amounts.discountCents > 0)
    stmts.push(
      db
        .prepare("INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES (?, ?, ?, 1, ?, ?)")
        .bind(crypto.randomUUID(), invoiceId, `Discount (${args.sub.discount_pct}%)`, -amounts.discountCents, -amounts.discountCents)
    );
  if (amounts.taxCents > 0)
    stmts.push(
      db
        .prepare("INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES (?, ?, ?, 1, ?, ?)")
        .bind(crypto.randomUUID(), invoiceId, `${args.settings.tax_label} (${(args.settings.tax_rate_bps / 100).toFixed(2)}%)`, amounts.taxCents, amounts.taxCents)
    );
  return { invoiceId, number, totalCents: amounts.totalCents, stmts };
}

/**
 * After an invoice stops being collectable-and-overdue (paid, voided, written
 * off), clears the account's past-due state and lifts a BILLING suspension —
 * but only if no other overdue invoice remains. A MANUAL suspension is never
 * lifted by money arriving; staff put it there for a reason.
 */
export async function settleStmts(
  db: D1Database,
  tenantId: string,
  excludeInvoiceId: string,
  actorId: string | null,
  now = Date.now()
): Promise<D1PreparedStatement[]> {
  const other = await db
    .prepare("SELECT COUNT(*) AS n FROM invoices WHERE tenant_id = ? AND status = 'OPEN' AND due_at < ? AND id != ?")
    .bind(tenantId, now, excludeInvoiceId)
    .first<{ n: number }>();
  if ((other?.n ?? 0) > 0) return [];
  const stmts: D1PreparedStatement[] = [];
  const sub = await db.prepare("SELECT * FROM subscriptions WHERE tenant_id = ?").bind(tenantId).first<SubRow>();
  if (sub && sub.status === "PAST_DUE") {
    const after = { ...sub, status: "ACTIVE" };
    stmts.push(
      db.prepare("UPDATE subscriptions SET status = 'ACTIVE', past_due_since = NULL, updated_at = ? WHERE id = ?").bind(now, sub.id),
      subEventStmt(db, { tenantId, subscriptionId: sub.id, type: "RECOVERED", before: sub, after, actorId, at: now })
    );
  }
  const tenant = await db
    .prepare("SELECT status, suspension_kind FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ status: string; suspension_kind: string | null }>();
  if (tenant?.status === "SUSPENDED" && tenant.suspension_kind === "BILLING") {
    stmts.push(
      db
        .prepare("UPDATE tenants SET status = 'ACTIVE', suspension_kind = NULL, suspended_reason = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?")
        .bind(now, tenantId),
      db
        .prepare(
          "INSERT INTO platform_audit_logs (id, admin_id, action, entity, entity_id, tenant_id, reason, created_at) VALUES (?, ?, 'tenant.unsuspend', 'tenant', ?, ?, 'Balance settled', ?)"
        )
        .bind(crypto.randomUUID(), actorId, tenantId, tenantId, now)
    );
  }
  return stmts;
}
