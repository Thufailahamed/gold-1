import { addInterval, DAY_MS, nextLifecycleAction, type CouponInput } from "@goldos/shared";
import { buildPlatformAudit, fail, getPlatformSettings, nextNumber, type Actor } from "../core";
import { buildSubscriptionInvoice, settleStmts, subEventStmt, type SubRow } from "./subcore";
import { loadTenant } from "./tenants";

/* ------------------------------------------------------------------ Invoices */

export type InvoiceRow = {
  id: string;
  number: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  kind: string;
  period_start: number | null;
  period_end: number | null;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  status: string;
  issued_at: number;
  due_at: number;
  paid_at: number | null;
  voided_at: number | null;
  void_reason: string | null;
  memo: string | null;
};

export async function listInvoices(
  db: D1Database,
  opts: { tenantId?: string; status?: string; overdue?: boolean; search?: string; page: number; limit: number }
): Promise<{ rows: InvoiceRow[]; total: number; totals: { open_cents: number; overdue_cents: number } }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  const now = Date.now();
  if (opts.tenantId) {
    where.push("i.tenant_id = ?");
    binds.push(opts.tenantId);
  }
  if (opts.status) {
    where.push("i.status = ?");
    binds.push(opts.status);
  }
  if (opts.overdue) {
    where.push("i.status = 'OPEN' AND i.due_at < ?");
    binds.push(now);
  }
  if (opts.search) {
    where.push("(i.number LIKE ? OR t.name LIKE ? OR t.slug LIKE ?)");
    const like = `%${opts.search}%`;
    binds.push(like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM invoices i JOIN tenants t ON t.id = i.tenant_id ${w}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT i.id, i.number, i.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, i.kind, i.period_start, i.period_end, i.currency,
              i.subtotal_cents, i.discount_cents, i.tax_cents, i.total_cents, i.amount_paid_cents, i.status, i.issued_at, i.due_at,
              i.paid_at, i.voided_at, i.void_reason, i.memo
       FROM invoices i JOIN tenants t ON t.id = i.tenant_id ${w}
       ORDER BY i.issued_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, (opts.page - 1) * opts.limit)
    .all<InvoiceRow>();
  const totals = await db
    .prepare(
      `SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS open_cents,
              COALESCE(SUM(CASE WHEN due_at < ? THEN total_cents - amount_paid_cents ELSE 0 END), 0) AS overdue_cents
       FROM invoices WHERE status = 'OPEN'${opts.tenantId ? " AND tenant_id = ?" : ""}`
    )
    .bind(now, ...(opts.tenantId ? [opts.tenantId] : []))
    .first<{ open_cents: number; overdue_cents: number }>();
  return { rows: results ?? [], total: total?.n ?? 0, totals: totals ?? { open_cents: 0, overdue_cents: 0 } };
}

export async function getInvoice(db: D1Database, id: string) {
  const inv = await db
    .prepare(
      `SELECT i.*, t.name AS tenant_name, t.slug AS tenant_slug, t.legal_name AS tenant_legal_name, t.owner_email AS tenant_email, t.country AS tenant_country
       FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.id = ?`
    )
    .bind(id)
    .first<InvoiceRow & { tenant_legal_name: string | null; tenant_email: string; tenant_country: string }>();
  if (!inv) fail("NOT_FOUND", "Invoice not found");
  const { results: lines } = await db
    .prepare("SELECT id, description, quantity, unit_cents, amount_cents FROM invoice_lines WHERE invoice_id = ?")
    .bind(id)
    .all();
  const { results: payments } = await db
    .prepare(
      `SELECT p.id, p.amount_cents, p.method, p.reference, p.received_at, a.name AS recorded_by
       FROM payments p LEFT JOIN platform_admins a ON a.id = p.created_by WHERE p.invoice_id = ? ORDER BY p.received_at`
    )
    .bind(id)
    .all();
  return { invoice: inv, lines: lines ?? [], payments: payments ?? [] };
}

async function loadOpenInvoice(db: D1Database, id: string) {
  const inv = await db
    .prepare("SELECT id, number, tenant_id, status, total_cents, amount_paid_cents FROM invoices WHERE id = ?")
    .bind(id)
    .first<{ id: string; number: string; tenant_id: string; status: string; total_cents: number; amount_paid_cents: number }>();
  if (!inv) fail("NOT_FOUND", "Invoice not found");
  if (inv.status !== "OPEN") fail("CONFLICT", `Invoice is ${inv.status.toLowerCase()}`);
  return inv;
}

export async function recordPayment(
  db: D1Database,
  invoiceId: string,
  input: { amountCents: number; method: string; reference?: string; receivedAt?: number },
  actor: Actor
): Promise<{ status: string }> {
  const inv = await loadOpenInvoice(db, invoiceId);
  const remaining = inv.total_cents - inv.amount_paid_cents;
  if (input.amountCents > remaining) fail("VALIDATION", `Payment exceeds the balance of ${(remaining / 100).toFixed(2)}`);
  const now = Date.now();
  const paidOff = input.amountCents === remaining;
  const paymentId = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO payments (id, invoice_id, tenant_id, amount_cents, method, reference, received_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(paymentId, inv.id, inv.tenant_id, input.amountCents, input.method, input.reference ?? null, input.receivedAt ?? now, now, actor.id),
    db
      .prepare(`UPDATE invoices SET amount_paid_cents = amount_paid_cents + ?, status = ?, paid_at = ? WHERE id = ?`)
      .bind(input.amountCents, paidOff ? "PAID" : "OPEN", paidOff ? now : null, inv.id),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "invoice.payment",
      entity: "invoice",
      entityId: inv.id,
      tenantId: inv.tenant_id,
      next: { number: inv.number, amountCents: input.amountCents, method: input.method, reference: input.reference ?? null, paidOff },
      ip: actor.ip,
    }),
  ];
  if (paidOff) stmts.push(...(await settleStmts(db, inv.tenant_id, inv.id, actor.id, now)));
  await db.batch(stmts);
  return { status: paidOff ? "PAID" : "OPEN" };
}

/**
 * Voiding is for invoices issued in error. One with money against it cannot
 * be voided — the payment would be orphaned; write it off instead.
 */
export async function voidInvoice(db: D1Database, invoiceId: string, reason: string, actor: Actor): Promise<void> {
  const inv = await loadOpenInvoice(db, invoiceId);
  if (inv.amount_paid_cents > 0) fail("CONFLICT", "Invoice has payments; mark it uncollectible instead");
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE invoices SET status = 'VOID', voided_at = ?, void_reason = ? WHERE id = ?").bind(now, reason, inv.id),
    buildPlatformAudit(db, { adminId: actor.id, action: "invoice.void", entity: "invoice", entityId: inv.id, tenantId: inv.tenant_id, prev: { status: "OPEN" }, next: { status: "VOID" }, reason, ip: actor.ip }),
    ...(await settleStmts(db, inv.tenant_id, inv.id, actor.id, now)),
  ]);
}

export async function markUncollectible(db: D1Database, invoiceId: string, reason: string, actor: Actor): Promise<void> {
  const inv = await loadOpenInvoice(db, invoiceId);
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE invoices SET status = 'UNCOLLECTIBLE', voided_at = ?, void_reason = ? WHERE id = ?").bind(now, reason, inv.id),
    buildPlatformAudit(db, {
      adminId: actor.id, action: "invoice.uncollectible", entity: "invoice", entityId: inv.id, tenantId: inv.tenant_id,
      prev: { status: "OPEN" }, next: { status: "UNCOLLECTIBLE", writtenOffCents: inv.total_cents - inv.amount_paid_cents }, reason, ip: actor.ip,
    }),
    ...(await settleStmts(db, inv.tenant_id, inv.id, actor.id, now)),
  ]);
}

export async function createManualInvoice(
  db: D1Database,
  input: { tenantId: string; description: string; amountCents: number; dueDays: number; memo?: string },
  actor: Actor
): Promise<{ id: string; number: string }> {
  const tenant = await loadTenant(db, input.tenantId);
  const settings = await getPlatformSettings(db);
  const tax = Math.round((input.amountCents * settings.tax_rate_bps) / 10000);
  const id = crypto.randomUUID();
  const number = await nextNumber(db, "INV", settings.invoice_prefix);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO invoices (id, number, tenant_id, kind, currency, subtotal_cents, discount_cents, tax_cents, total_cents, amount_paid_cents,
          status, issued_at, due_at, memo, created_at, created_by)
         VALUES (?, ?, ?, 'MANUAL', ?, ?, 0, ?, ?, 0, 'OPEN', ?, ?, ?, ?, ?)`
      )
      .bind(id, number, tenant.id, tenant.currency, input.amountCents, tax, input.amountCents + tax, now, now + input.dueDays * DAY_MS, input.memo ?? null, now, actor.id),
    db
      .prepare("INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES (?, ?, ?, 1, ?, ?)")
      .bind(crypto.randomUUID(), id, input.description, input.amountCents, input.amountCents),
    buildPlatformAudit(db, { adminId: actor.id, action: "invoice.create_manual", entity: "invoice", entityId: id, tenantId: tenant.id, next: { number, amountCents: input.amountCents, description: input.description }, ip: actor.ip }),
  ];
  if (tax > 0)
    stmts.splice(2, 0,
      db
        .prepare("INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents, amount_cents) VALUES (?, ?, ?, 1, ?, ?)")
        .bind(crypto.randomUUID(), id, `${settings.tax_label} (${(settings.tax_rate_bps / 100).toFixed(2)}%)`, tax, tax)
    );
  await db.batch(stmts);
  return { id, number };
}

export async function listPayments(db: D1Database, opts: { tenantId?: string; page: number; limit: number }) {
  const w = opts.tenantId ? "WHERE p.tenant_id = ?" : "";
  const binds = opts.tenantId ? [opts.tenantId] : [];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM payments p ${w}`).bind(...binds).first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT p.id, p.amount_cents, p.method, p.reference, p.received_at, i.number AS invoice_number, i.id AS invoice_id, i.currency,
              t.name AS tenant_name, t.id AS tenant_id, a.name AS recorded_by
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN tenants t ON t.id = p.tenant_id LEFT JOIN platform_admins a ON a.id = p.created_by
       ${w} ORDER BY p.received_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, (opts.page - 1) * opts.limit)
    .all();
  return { rows: results ?? [], total: total?.n ?? 0 };
}

/* ------------------------------------------------------------------ Coupons */

export async function listCoupons(db: D1Database) {
  const { results } = await db.prepare("SELECT * FROM coupons ORDER BY is_active DESC, created_at DESC").all();
  return results ?? [];
}

export async function createCoupon(db: D1Database, input: CouponInput, actor: Actor): Promise<{ id: string }> {
  const code = input.code.toUpperCase();
  if (await db.prepare("SELECT id FROM coupons WHERE code = ?").bind(code).first()) fail("CONFLICT", "Coupon code already exists");
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO coupons (id, code, description, percent_off, duration_months, max_redemptions, expires_at, is_active, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
      )
      .bind(id, code, input.description, input.percentOff, input.durationMonths, input.maxRedemptions, input.expiresAt, Date.now(), actor.id),
    buildPlatformAudit(db, { adminId: actor.id, action: "coupon.create", entity: "coupon", entityId: id, next: { ...input, code }, ip: actor.ip }),
  ]);
  return { id };
}

/** Coupons are never deleted — subscriptions reference them. They are retired. */
export async function setCouponActive(db: D1Database, id: string, active: boolean, actor: Actor): Promise<void> {
  const c = await db.prepare("SELECT is_active FROM coupons WHERE id = ?").bind(id).first<{ is_active: number }>();
  if (!c) fail("NOT_FOUND", "Coupon not found");
  await db.batch([
    db.prepare("UPDATE coupons SET is_active = ? WHERE id = ?").bind(active ? 1 : 0, id),
    buildPlatformAudit(db, { adminId: actor.id, action: active ? "coupon.activate" : "coupon.retire", entity: "coupon", entityId: id, prev: { is_active: c.is_active }, next: { is_active: active ? 1 : 0 }, ip: actor.ip }),
  ]);
}

/* ------------------------------------------------------------------ Billing cycle */

export type CycleSummary = {
  trialsConverted: number;
  renewed: number;
  canceled: number;
  invoicesIssued: number;
  discountsEnded: number;
  markedPastDue: number;
  suspended: number;
  errors: Array<{ subscriptionId: string; message: string }>;
};

/**
 * One pass of the subscription clock. Idempotent: every step keys off state
 * the previous run already advanced, and the partial unique index on
 * (subscription_id, period_start) makes a double-issued invoice impossible
 * even if two runs overlap. Each subscription commits on its own, so one bad
 * row does not stall everyone else's renewal.
 */
export async function runBillingCycle(db: D1Database, actorId: string | null, now = Date.now()): Promise<CycleSummary> {
  const settings = await getPlatformSettings(db);
  const summary: CycleSummary = { trialsConverted: 0, renewed: 0, canceled: 0, invoicesIssued: 0, discountsEnded: 0, markedPastDue: 0, suspended: 0, errors: [] };

  const { results: due } = await db
    .prepare(
      `SELECT s.*, p.name AS plan_name, t.currency AS tenant_currency, t.status AS tenant_status
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id
       WHERE s.status != 'CANCELED'
         AND ((s.status = 'TRIALING' AND s.trial_ends_at <= ?) OR (s.status IN ('ACTIVE','PAST_DUE') AND s.current_period_end <= ?))
       LIMIT 500`
    )
    .bind(now, now)
    .all<SubRow & { plan_name: string; tenant_currency: string; tenant_status: string }>();

  for (const row of due ?? []) {
    try {
      const { plan_name, tenant_currency, tenant_status, ...sub } = row;
      const action = nextLifecycleAction(
        { status: sub.status, trialEndsAt: sub.trial_ends_at, currentPeriodEnd: sub.current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end === 1 },
        now
      );
      if (action === "none") continue;
      // An archived account is never billed again.
      if (action === "cancel" || tenant_status === "ARCHIVED") {
        await db.batch([
          db
            .prepare("UPDATE subscriptions SET status = 'CANCELED', canceled_at = ?, cancel_at_period_end = 0, past_due_since = NULL, updated_at = ? WHERE id = ?")
            .bind(now, now, sub.id),
          subEventStmt(db, { tenantId: sub.tenant_id, subscriptionId: sub.id, type: "CANCELED", before: sub, after: { ...sub, status: "CANCELED" }, reason: sub.cancel_reason ?? "Period ended", actorId, at: now }),
        ]);
        summary.canceled++;
        continue;
      }
      const periodStart = action === "end_trial" ? (sub.trial_ends_at as number) : sub.current_period_end;
      const periodEnd = addInterval(periodStart, sub.billing_interval);
      const discountEnds = sub.discount_ends_at !== null && sub.discount_ends_at <= periodStart;
      const priced = { ...sub, discount_pct: discountEnds ? 0 : sub.discount_pct };
      const nextStatus = sub.status === "PAST_DUE" ? "PAST_DUE" : "ACTIVE";
      const after = { ...priced, status: nextStatus };
      const invoice = await buildSubscriptionInvoice(db, {
        sub: priced, planName: plan_name, currency: tenant_currency, periodStart, periodEnd, settings, actorId, now,
      });
      const stmts: D1PreparedStatement[] = [
        db
          .prepare(
            `UPDATE subscriptions SET status = ?, current_period_start = ?, current_period_end = ?, trial_ends_at = NULL,
               discount_pct = ?, coupon_id = ?, discount_ends_at = ?, updated_at = ? WHERE id = ?`
          )
          .bind(nextStatus, periodStart, periodEnd, priced.discount_pct, discountEnds ? null : sub.coupon_id, discountEnds ? null : sub.discount_ends_at, now, sub.id),
        subEventStmt(db, {
          tenantId: sub.tenant_id, subscriptionId: sub.id, type: action === "end_trial" ? "TRIAL_CONVERTED" : "RENEWED",
          before: sub, after, actorId, at: now,
        }),
        ...(invoice?.stmts ?? []),
      ];
      await db.batch(stmts);
      if (action === "end_trial") summary.trialsConverted++;
      else summary.renewed++;
      if (invoice) summary.invoicesIssued++;
      if (discountEnds) summary.discountsEnded++;
    } catch (e) {
      summary.errors.push({ subscriptionId: row.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Overdue sweep: an unpaid invoice past its due date puts the account past due.
  const { results: overdue } = await db
    .prepare(
      `SELECT s.*, MIN(i.due_at) AS first_due FROM subscriptions s JOIN invoices i ON i.tenant_id = s.tenant_id
       WHERE s.status = 'ACTIVE' AND i.status = 'OPEN' AND i.due_at < ? GROUP BY s.id`
    )
    .bind(now)
    .all<SubRow & { first_due: number }>();
  for (const { first_due, ...sub } of overdue ?? []) {
    await db.batch([
      db.prepare("UPDATE subscriptions SET status = 'PAST_DUE', past_due_since = ?, updated_at = ? WHERE id = ?").bind(first_due, now, sub.id),
      subEventStmt(db, { tenantId: sub.tenant_id, subscriptionId: sub.id, type: "PAST_DUE", before: sub, after: { ...sub, status: "PAST_DUE" }, actorId, at: now }),
    ]);
    summary.markedPastDue++;
  }

  // Dunning: past due beyond the grace window suspends access until paid.
  if (settings.auto_suspend_past_due) {
    const cutoff = now - settings.past_due_grace_days * DAY_MS;
    const { results: late } = await db
      .prepare(
        `SELECT t.id FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
         WHERE t.status = 'ACTIVE' AND s.status = 'PAST_DUE' AND s.past_due_since IS NOT NULL AND s.past_due_since <= ?`
      )
      .bind(cutoff)
      .all<{ id: string }>();
    for (const t of late ?? []) {
      const reason = `Unpaid for more than ${settings.past_due_grace_days} days`;
      await db.batch([
        db
          .prepare("UPDATE tenants SET status = 'SUSPENDED', suspension_kind = 'BILLING', suspended_reason = ?, suspended_at = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'")
          .bind(reason, now, now, t.id),
        buildPlatformAudit(db, { adminId: actorId, action: "tenant.suspend", entity: "tenant", entityId: t.id, tenantId: t.id, next: { status: "SUSPENDED", kind: "BILLING" }, reason }),
      ]);
      summary.suspended++;
    }
  }
  return summary;
}
