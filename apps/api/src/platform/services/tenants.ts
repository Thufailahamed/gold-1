import {
  addInterval,
  DAY_MS,
  evaluateFlag,
  limitStatus,
  type CreateTenantInput,
  type EditTenantInput,
} from "@goldos/shared";
import { buildPlatformAudit, fail, getPlatformSettings, parseJsonArray, type Actor } from "../core";
import { buildSubscriptionInvoice, loadPlan, mrrOf, planPrice, subEventStmt, type PlanRow, type SubRow } from "./subcore";

export const ARCHIVE_RETENTION_DAYS = 30;

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  status: string;
  owner_name: string;
  owner_email: string;
  phone: string | null;
  country: string;
  currency: string;
  timezone: string;
  region: string;
  custom_domain: string | null;
  data_plane: string | null;
  tags_json: string;
  suspension_kind: string | null;
  suspended_reason: string | null;
  suspended_at: number | null;
  deletion_scheduled_at: number | null;
  last_active_at: number | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
};

export async function loadTenant(db: D1Database, id: string): Promise<TenantRow> {
  const t = await db.prepare("SELECT * FROM tenants WHERE id = ?").bind(id).first<TenantRow>();
  if (!t) fail("NOT_FOUND", "Account not found");
  return t;
}

/* ------------------------------------------------------------------ Create */

export async function createTenant(db: D1Database, input: CreateTenantInput, actor: Actor): Promise<{ id: string; invoiceNumber: string | null }> {
  const slugTaken = await db.prepare("SELECT id FROM tenants WHERE slug = ?").bind(input.slug).first();
  if (slugTaken) fail("CONFLICT", "That subdomain is already taken");
  const plan = await loadPlan(db, input.planId);
  if (!plan.is_active) fail("VALIDATION", "That plan is archived");
  const settings = await getPlatformSettings(db);

  const id = crypto.randomUUID();
  const subId = crypto.randomUUID();
  const now = Date.now();
  const trialDays = input.trialDays ?? plan.trial_days;
  const price = planPrice(plan, input.interval);
  const trialing = trialDays > 0;
  const trialEnds = trialing ? now + trialDays * DAY_MS : null;
  const periodEnd = trialEnds ?? addInterval(now, input.interval);
  const sub: SubRow = {
    id: subId,
    tenant_id: id,
    plan_id: plan.id,
    status: trialing ? "TRIALING" : "ACTIVE",
    billing_interval: input.interval,
    price_cents: price,
    discount_pct: 0,
    coupon_id: null,
    discount_ends_at: null,
    trial_ends_at: trialEnds,
    current_period_start: now,
    current_period_end: periodEnd,
    cancel_at_period_end: 0,
    canceled_at: null,
    cancel_reason: null,
    past_due_since: null,
    created_at: now,
    updated_at: now,
  };

  const invoice = trialing
    ? null
    : await buildSubscriptionInvoice(db, {
        sub,
        planName: plan.name,
        currency: input.currency,
        periodStart: now,
        periodEnd,
        settings,
        actorId: actor.id,
        now,
      });

  await db.batch([
    db
      .prepare(
        `INSERT INTO tenants (id, slug, name, legal_name, status, owner_name, owner_email, phone, country, currency, timezone, region, tags_json, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, input.slug, input.name, input.legalName ?? null, input.ownerName, input.ownerEmail.toLowerCase(), input.phone ?? null,
        input.country.toUpperCase(), input.currency.toUpperCase(), input.timezone, input.region, JSON.stringify(input.tags), now, now, actor.id
      ),
    db
      .prepare(
        `INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_interval, price_cents, discount_pct, trial_ends_at,
          current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?)`
      )
      .bind(subId, id, plan.id, sub.status, sub.billing_interval, price, trialEnds, now, periodEnd, now, now),
    subEventStmt(db, { tenantId: id, subscriptionId: subId, type: "CREATED", before: null, after: sub, actorId: actor.id, at: now }),
    ...(invoice?.stmts ?? []),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "tenant.create",
      entity: "tenant",
      entityId: id,
      tenantId: id,
      next: { slug: input.slug, name: input.name, plan: plan.code, interval: input.interval, trialDays },
      ip: actor.ip,
    }),
  ]);
  return { id, invoiceNumber: invoice?.number ?? null };
}

/* ------------------------------------------------------------------ Read */

export type TenantListRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  owner_email: string;
  owner_name: string;
  country: string;
  currency: string;
  created_at: number;
  last_active_at: number | null;
  plan_name: string | null;
  plan_code: string | null;
  sub_status: string | null;
  billing_interval: string | null;
  price_cents: number | null;
  discount_pct: number | null;
  trial_ends_at: number | null;
  current_period_end: number | null;
  cancel_at_period_end: number | null;
  open_balance_cents: number;
  mrr_cents: number;
  tags: string[];
};

export async function listTenants(
  db: D1Database,
  opts: { search?: string; status?: string; subStatus?: string; planId?: string; page: number; limit: number; sort?: string }
): Promise<{ rows: TenantListRow[]; total: number }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.search) {
    where.push("(t.name LIKE ? OR t.slug LIKE ? OR t.owner_email LIKE ? OR t.custom_domain LIKE ?)");
    const like = `%${opts.search}%`;
    binds.push(like, like, like, like);
  }
  if (opts.status) {
    where.push("t.status = ?");
    binds.push(opts.status);
  }
  if (opts.subStatus) {
    where.push("s.status = ?");
    binds.push(opts.subStatus);
  }
  if (opts.planId) {
    where.push("s.plan_id = ?");
    binds.push(opts.planId);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order =
    {
      name: "t.name ASC",
      oldest: "t.created_at ASC",
      active: "COALESCE(t.last_active_at, 0) DESC",
      balance: "open_balance_cents DESC",
    }[opts.sort ?? ""] ?? "t.created_at DESC";
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id ${w}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT t.id, t.slug, t.name, t.status, t.owner_email, t.owner_name, t.country, t.currency, t.created_at, t.last_active_at, t.tags_json,
              p.name AS plan_name, p.code AS plan_code, s.status AS sub_status, s.billing_interval, s.price_cents, s.discount_pct,
              s.trial_ends_at, s.current_period_end, s.cancel_at_period_end,
              COALESCE((SELECT SUM(i.total_cents - i.amount_paid_cents) FROM invoices i WHERE i.tenant_id = t.id AND i.status = 'OPEN'), 0) AS open_balance_cents
       FROM tenants t
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       LEFT JOIN plans p ON p.id = s.plan_id
       ${w}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, opts.limit, (opts.page - 1) * opts.limit)
    .all<Omit<TenantListRow, "mrr_cents" | "tags"> & { tags_json: string }>();
  const rows = (results ?? []).map(({ tags_json, ...r }) => ({
    ...r,
    tags: parseJsonArray(tags_json),
    mrr_cents:
      r.sub_status && r.billing_interval && r.price_cents !== null
        ? mrrOf({ plan_id: "", status: r.sub_status, billing_interval: r.billing_interval as "MONTH" | "YEAR", price_cents: r.price_cents, discount_pct: r.discount_pct ?? 0 })
        : 0,
  }));
  return { rows, total: total?.n ?? 0 };
}

export type UsageRow = {
  users: number;
  branches: number;
  products: number;
  sales_30d: number;
  sales_30d_cents: number;
  storage_mb: number;
  last_active_at: number | null;
  captured_at: number;
};

export async function latestUsage(db: D1Database, tenantId: string): Promise<UsageRow | null> {
  return db
    .prepare(
      "SELECT users, branches, products, sales_30d, sales_30d_cents, storage_mb, last_active_at, captured_at FROM usage_snapshots WHERE tenant_id = ? ORDER BY captured_at DESC LIMIT 1"
    )
    .bind(tenantId)
    .first<UsageRow>();
}

export async function tenantFlags(db: D1Database, tenantId: string, plan: PlanRow | null) {
  const { results: flags } = await db
    .prepare("SELECT key, description, default_enabled, rollout_pct FROM feature_flags ORDER BY key")
    .all<{ key: string; description: string; default_enabled: number; rollout_pct: number }>();
  const { results: overrides } = await db
    .prepare("SELECT flag_key, enabled FROM tenant_feature_overrides WHERE tenant_id = ?")
    .bind(tenantId)
    .all<{ flag_key: string; enabled: number }>();
  const ov = new Map((overrides ?? []).map((o) => [o.flag_key, o.enabled === 1]));
  const planFeatures = plan ? parseJsonArray(plan.features_json) : [];
  return (flags ?? []).map((f) => {
    const override = ov.has(f.key) ? (ov.get(f.key) as boolean) : null;
    const res = evaluateFlag(
      { key: f.key, defaultEnabled: f.default_enabled === 1, rolloutPct: f.rollout_pct },
      { tenantId, planFeatures, override }
    );
    return { key: f.key, description: f.description, override, ...res };
  });
}

export async function getTenantDetail(db: D1Database, id: string) {
  const tenant = await loadTenant(db, id);
  const sub = await db.prepare("SELECT * FROM subscriptions WHERE tenant_id = ?").bind(id).first<SubRow>();
  const plan = sub ? await db.prepare("SELECT * FROM plans WHERE id = ?").bind(sub.plan_id).first<PlanRow>() : null;
  const usage = await latestUsage(db, id);
  const balance = await db
    .prepare(
      `SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS open_cents,
              COALESCE(SUM(CASE WHEN due_at < ? THEN total_cents - amount_paid_cents ELSE 0 END), 0) AS overdue_cents,
              COUNT(*) AS open_count
       FROM invoices WHERE tenant_id = ? AND status = 'OPEN'`
    )
    .bind(Date.now(), id)
    .first<{ open_cents: number; overdue_cents: number; open_count: number }>();
  const lifetime = await db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE tenant_id = ?")
    .bind(id)
    .first<{ paid: number }>();
  const { results: notes } = await db
    .prepare(
      `SELECT n.id, n.body, n.pinned, n.created_at, n.created_by, a.name AS author_name
       FROM tenant_notes n LEFT JOIN platform_admins a ON a.id = n.created_by
       WHERE n.tenant_id = ? ORDER BY n.pinned DESC, n.created_at DESC LIMIT 50`
    )
    .bind(id)
    .all();
  const { results: events } = await db
    .prepare(
      `SELECT e.id, e.type, e.from_status, e.to_status, e.mrr_delta_cents, e.reason, e.created_at, fp.name AS from_plan, tp.name AS to_plan
       FROM subscription_events e LEFT JOIN plans fp ON fp.id = e.from_plan_id LEFT JOIN plans tp ON tp.id = e.to_plan_id
       WHERE e.tenant_id = ? ORDER BY e.created_at DESC LIMIT 30`
    )
    .bind(id)
    .all();
  const { results: usageHistory } = await db
    .prepare("SELECT users, branches, products, sales_30d, captured_at FROM usage_snapshots WHERE tenant_id = ? ORDER BY captured_at DESC LIMIT 30")
    .bind(id)
    .all();
  const { results: tickets } = await db
    .prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE tenant_id = ? AND status IN ('OPEN','PENDING')")
    .bind(id)
    .all<{ n: number }>();

  const limits = plan
    ? {
        users: { used: usage?.users ?? 0, max: plan.max_users, ...limitStatus(usage?.users ?? 0, plan.max_users) },
        branches: { used: usage?.branches ?? 0, max: plan.max_branches, ...limitStatus(usage?.branches ?? 0, plan.max_branches) },
        products: { used: usage?.products ?? 0, max: plan.max_products, ...limitStatus(usage?.products ?? 0, plan.max_products) },
        storageMb: { used: usage?.storage_mb ?? 0, max: plan.max_storage_mb, ...limitStatus(usage?.storage_mb ?? 0, plan.max_storage_mb) },
      }
    : null;

  const { tags_json, ...rest } = tenant;
  return {
    tenant: { ...rest, tags: parseJsonArray(tags_json) },
    subscription: sub ? { ...sub, mrr_cents: mrrOf(sub) } : null,
    plan: plan ? { ...plan, features: parseJsonArray(plan.features_json) } : null,
    usage,
    usageHistory: usageHistory ?? [],
    limits,
    balance: { ...(balance ?? { open_cents: 0, overdue_cents: 0, open_count: 0 }), lifetime_paid_cents: lifetime?.paid ?? 0 },
    notes: notes ?? [],
    events: events ?? [],
    flags: await tenantFlags(db, id, plan),
    openTickets: tickets?.[0]?.n ?? 0,
  };
}

/* ------------------------------------------------------------------ Update */

export async function editTenant(db: D1Database, id: string, patch: EditTenantInput, actor: Actor): Promise<void> {
  const prev = await loadTenant(db, id);
  if (patch.customDomain) {
    const clash = await db.prepare("SELECT id FROM tenants WHERE custom_domain = ? AND id != ?").bind(patch.customDomain, id).first();
    if (clash) fail("CONFLICT", "That domain is attached to another account");
  }
  const cols: Record<string, unknown> = {
    name: patch.name,
    legal_name: patch.legalName,
    owner_name: patch.ownerName,
    owner_email: patch.ownerEmail?.toLowerCase(),
    phone: patch.phone,
    country: patch.country?.toUpperCase(),
    timezone: patch.timezone,
    region: patch.region,
    custom_domain: patch.customDomain,
    data_plane: patch.dataPlane,
    tags_json: patch.tags ? JSON.stringify(patch.tags) : undefined,
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (set.length === 0) return;
  const prevSubset = Object.fromEntries(set.map(([k]) => [k, (prev as unknown as Record<string, unknown>)[k]]));
  await db.batch([
    db
      .prepare(`UPDATE tenants SET ${set.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...set.map(([, v]) => v), Date.now(), id),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "tenant.edit",
      entity: "tenant",
      entityId: id,
      tenantId: id,
      prev: prevSubset,
      next: Object.fromEntries(set),
      ip: actor.ip,
    }),
  ]);
}

export async function suspendTenant(db: D1Database, id: string, reason: string, actor: Actor): Promise<void> {
  const t = await loadTenant(db, id);
  if (t.status !== "ACTIVE") fail("CONFLICT", `Account is ${t.status.toLowerCase()}`);
  const now = Date.now();
  await db.batch([
    db
      .prepare("UPDATE tenants SET status = 'SUSPENDED', suspension_kind = 'MANUAL', suspended_reason = ?, suspended_at = ?, updated_at = ? WHERE id = ?")
      .bind(reason, now, now, id),
    buildPlatformAudit(db, { adminId: actor.id, action: "tenant.suspend", entity: "tenant", entityId: id, tenantId: id, prev: { status: t.status }, next: { status: "SUSPENDED" }, reason, ip: actor.ip }),
  ]);
}

export async function unsuspendTenant(db: D1Database, id: string, reason: string, actor: Actor): Promise<void> {
  const t = await loadTenant(db, id);
  if (t.status !== "SUSPENDED") fail("CONFLICT", "Account is not suspended");
  await db.batch([
    db
      .prepare("UPDATE tenants SET status = 'ACTIVE', suspension_kind = NULL, suspended_reason = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?")
      .bind(Date.now(), id),
    buildPlatformAudit(db, { adminId: actor.id, action: "tenant.unsuspend", entity: "tenant", entityId: id, tenantId: id, prev: { status: t.status, kind: t.suspension_kind }, next: { status: "ACTIVE" }, reason, ip: actor.ip }),
  ]);
}

/**
 * Archiving is the reversible half of deletion: access stops, the
 * subscription is cancelled, and the account is scheduled for purge after the
 * retention window. Restoring inside the window brings the account back
 * exactly as it was, minus the subscription (which staff reactivate).
 */
export async function archiveTenant(db: D1Database, id: string, reason: string, actor: Actor): Promise<{ deletionScheduledAt: number }> {
  const t = await loadTenant(db, id);
  if (t.status === "ARCHIVED") fail("CONFLICT", "Account is already archived");
  const now = Date.now();
  const purgeAt = now + ARCHIVE_RETENTION_DAYS * DAY_MS;
  const sub = await db.prepare("SELECT * FROM subscriptions WHERE tenant_id = ?").bind(id).first<SubRow>();
  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE tenants SET status = 'ARCHIVED', deletion_scheduled_at = ?, updated_at = ? WHERE id = ?").bind(purgeAt, now, id),
    buildPlatformAudit(db, { adminId: actor.id, action: "tenant.archive", entity: "tenant", entityId: id, tenantId: id, prev: { status: t.status }, next: { status: "ARCHIVED", deletionScheduledAt: purgeAt }, reason, ip: actor.ip }),
  ];
  if (sub && sub.status !== "CANCELED") {
    stmts.push(
      db
        .prepare("UPDATE subscriptions SET status = 'CANCELED', canceled_at = ?, cancel_reason = ?, cancel_at_period_end = 0, updated_at = ? WHERE id = ?")
        .bind(now, reason, now, sub.id),
      subEventStmt(db, { tenantId: id, subscriptionId: sub.id, type: "CANCELED", before: sub, after: { ...sub, status: "CANCELED" }, reason, actorId: actor.id, at: now })
    );
  }
  await db.batch(stmts);
  return { deletionScheduledAt: purgeAt };
}

export async function restoreTenant(db: D1Database, id: string, reason: string, actor: Actor): Promise<void> {
  const t = await loadTenant(db, id);
  if (t.status !== "ARCHIVED") fail("CONFLICT", "Account is not archived");
  await db.batch([
    db
      .prepare("UPDATE tenants SET status = 'ACTIVE', deletion_scheduled_at = NULL, suspension_kind = NULL, suspended_reason = NULL, suspended_at = NULL, updated_at = ? WHERE id = ?")
      .bind(Date.now(), id),
    buildPlatformAudit(db, { adminId: actor.id, action: "tenant.restore", entity: "tenant", entityId: id, tenantId: id, prev: { status: "ARCHIVED" }, next: { status: "ACTIVE" }, reason, ip: actor.ip }),
  ]);
}

/* ------------------------------------------------------------------ Notes & overrides */

export async function addNote(db: D1Database, tenantId: string, body: string, pinned: boolean, actor: Actor): Promise<{ id: string }> {
  await loadTenant(db, tenantId);
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO tenant_notes (id, tenant_id, body, pinned, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, tenantId, body, pinned ? 1 : 0, Date.now(), actor.id),
    buildPlatformAudit(db, { adminId: actor.id, action: "tenant.note_add", entity: "tenant_note", entityId: id, tenantId, ip: actor.ip }),
  ]);
  return { id };
}

export async function deleteNote(db: D1Database, tenantId: string, noteId: string, actor: Actor): Promise<void> {
  const n = await db.prepare("SELECT body FROM tenant_notes WHERE id = ? AND tenant_id = ?").bind(noteId, tenantId).first<{ body: string }>();
  if (!n) fail("NOT_FOUND", "Note not found");
  await db.batch([
    db.prepare("DELETE FROM tenant_notes WHERE id = ?").bind(noteId),
    buildPlatformAudit(db, { adminId: actor.id, action: "tenant.note_delete", entity: "tenant_note", entityId: noteId, tenantId, prev: { body: n.body }, ip: actor.ip }),
  ]);
}

export async function toggleNotePin(db: D1Database, tenantId: string, noteId: string): Promise<void> {
  await db.prepare("UPDATE tenant_notes SET pinned = 1 - pinned WHERE id = ? AND tenant_id = ?").bind(noteId, tenantId).run();
}

export async function setFlagOverride(db: D1Database, tenantId: string, flagKey: string, enabled: boolean | null, actor: Actor): Promise<void> {
  await loadTenant(db, tenantId);
  const flag = await db.prepare("SELECT key FROM feature_flags WHERE key = ?").bind(flagKey).first();
  if (!flag) fail("NOT_FOUND", "Flag not found");
  const prev = await db
    .prepare("SELECT enabled FROM tenant_feature_overrides WHERE tenant_id = ? AND flag_key = ?")
    .bind(tenantId, flagKey)
    .first<{ enabled: number }>();
  const stmt =
    enabled === null
      ? db.prepare("DELETE FROM tenant_feature_overrides WHERE tenant_id = ? AND flag_key = ?").bind(tenantId, flagKey)
      : db
          .prepare(
            "INSERT INTO tenant_feature_overrides (tenant_id, flag_key, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id, flag_key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
          )
          .bind(tenantId, flagKey, enabled ? 1 : 0, Date.now(), actor.id);
  await db.batch([
    stmt,
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "tenant.flag_override",
      entity: "feature_flag",
      entityId: flagKey,
      tenantId,
      prev: { enabled: prev ? prev.enabled === 1 : null },
      next: { enabled },
      ip: actor.ip,
    }),
  ]);
}

export function tenantsCsv(rows: TenantListRow[]): string {
  const cols = ["slug", "name", "status", "owner_email", "plan", "sub_status", "interval", "mrr", "open_balance", "country", "created_at", "last_active_at"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.slug, r.name, r.status, r.owner_email, r.plan_code, r.sub_status, r.billing_interval,
      (r.mrr_cents / 100).toFixed(2), (r.open_balance_cents / 100).toFixed(2), r.country,
      new Date(r.created_at).toISOString(), r.last_active_at ? new Date(r.last_active_at).toISOString() : "",
    ].map(esc).join(",")
  );
  return [cols.join(","), ...lines].join("\n");
}

/* ------------------------------------------------------------------ Bulk + purge + export (full admin control) */

export type BulkTenantAction = "suspend" | "unsuspend" | "archive" | "restore" | "change-plan";

export async function bulkTenants(
  db: D1Database,
  input: { ids: string[]; action: BulkTenantAction; reason: string; planId?: string; interval?: "MONTH" | "YEAR" },
  actor: Actor
): Promise<{ results: Array<{ id: string; ok: boolean; error?: string }> }> {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of input.ids) {
    try {
      if (input.action === "suspend") await suspendTenant(db, id, input.reason, actor);
      else if (input.action === "unsuspend") await unsuspendTenant(db, id, input.reason, actor);
      else if (input.action === "archive") await archiveTenant(db, id, input.reason, actor);
      else if (input.action === "restore") await restoreTenant(db, id, input.reason, actor);
      else if (input.action === "change-plan") {
        if (!input.planId) fail("VALIDATION", "planId is required for change-plan");
        const { loadSub } = await import("./subcore");
        const sub = await loadSub(db, id);
        if (sub.status === "CANCELED") fail("CONFLICT", "Reactivate the subscription before changing plan");
        const plan = await loadPlan(db, input.planId);
        if (!plan.is_active) fail("VALIDATION", "That plan is archived");
        const interval = input.interval ?? (sub.billing_interval as "MONTH" | "YEAR");
        const price = planPrice(plan, interval);
        const now = Date.now();
        await db.batch([
          db.prepare("UPDATE subscriptions SET plan_id = ?, billing_interval = ?, price_cents = ?, updated_at = ? WHERE id = ?").bind(plan.id, interval, price, now, sub.id),
          subEventStmt(db, { tenantId: id, subscriptionId: sub.id, type: "PLAN_CHANGED", before: sub, after: { ...sub, plan_id: plan.id, billing_interval: interval, price_cents: price }, reason: input.reason, actorId: actor.id, at: now }),
          buildPlatformAudit(db, { adminId: actor.id, action: "subscription.change_plan", entity: "subscription", entityId: sub.id, tenantId: id, prev: { plan_id: sub.plan_id }, next: { plan_id: plan.id, interval, price_cents: price }, reason: input.reason, ip: actor.ip }),
        ]);
      }
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results };
}

/**
 * Hard delete of an archived account and every control-plane row that
 * references it. Only ARCHIVED accounts can be purged — this is the
 * irreversible half of deletion (GDPR erase). Callers should export first.
 */
export async function purgeTenant(db: D1Database, id: string, reason: string, actor: Actor): Promise<{ purged: string }> {
  const t = await loadTenant(db, id);
  if (t.status !== "ARCHIVED") fail("CONFLICT", "Only archived accounts can be purged — archive first");
  const sub = await db.prepare("SELECT id FROM subscriptions WHERE tenant_id = ?").bind(id).first<{ id: string }>();
  const subId = sub?.id;
  const stmts: D1PreparedStatement[] = [];
  if (subId) {
    const invs = await db.prepare("SELECT id FROM invoices WHERE tenant_id = ?").bind(id).all<{ id: string }>();
    for (const inv of invs.results ?? []) {
      stmts.push(db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(inv.id));
    }
    stmts.push(
      db.prepare("DELETE FROM payments WHERE tenant_id = ?").bind(id),
      db.prepare("DELETE FROM invoices WHERE tenant_id = ?").bind(id),
      db.prepare("DELETE FROM subscription_events WHERE subscription_id = ?").bind(subId),
      db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(subId)
    );
  }
  stmts.push(
    db.prepare("DELETE FROM tenant_notes WHERE tenant_id = ?").bind(id),
    db.prepare("DELETE FROM tenant_feature_overrides WHERE tenant_id = ?").bind(id),
    db.prepare("DELETE FROM usage_snapshots WHERE tenant_id = ?").bind(id),
    db.prepare("DELETE FROM impersonation_grants WHERE tenant_id = ?").bind(id),
    db.prepare("DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE tenant_id = ?)").bind(id),
    db.prepare("DELETE FROM support_tickets WHERE tenant_id = ?").bind(id),
    db.prepare("DELETE FROM tenants WHERE id = ?").bind(id),
    buildPlatformAudit(db, { adminId: actor.id, action: "tenant.purge", entity: "tenant", entityId: id, tenantId: null, prev: { slug: t.slug, name: t.name, status: t.status }, reason, ip: actor.ip })
  );
  await db.batch(stmts);
  return { purged: id };
}

/** Full JSON snapshot of an account for export-before-purge / compliance. */
export async function exportTenant(db: D1Database, id: string) {
  const detail = await getTenantDetail(db, id);
  const { results: invoices } = await db.prepare("SELECT * FROM invoices WHERE tenant_id = ? ORDER BY issued_at").bind(id).all();
  const { results: payments } = await db.prepare("SELECT * FROM payments WHERE tenant_id = ? ORDER BY received_at").bind(id).all();
  const { results: tickets } = await db.prepare("SELECT * FROM support_tickets WHERE tenant_id = ? ORDER BY created_at").bind(id).all();
  const { results: audit } = await db.prepare("SELECT * FROM platform_audit_logs WHERE tenant_id = ? ORDER BY created_at").bind(id).all();
  return { ...detail, invoices: invoices ?? [], payments: payments ?? [], tickets: tickets ?? [], audit: audit ?? [], exportedAt: Date.now() };
}
