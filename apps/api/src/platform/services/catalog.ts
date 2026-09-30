import type { AnnouncementInput, EditPlanInput, PlanInput } from "@goldos/shared";
import { buildPlatformAudit, fail, parseJsonArray, type Actor } from "../core";
import type { PlanRow } from "./subcore";

/* ------------------------------------------------------------------ Plans */

export async function listPlans(db: D1Database, opts: { includeArchived?: boolean } = {}) {
  const { results } = await db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status != 'CANCELED') AS subscribers
       FROM plans p ${opts.includeArchived ? "" : "WHERE p.is_active = 1"} ORDER BY p.sort_order, p.price_monthly_cents`
    )
    .all<PlanRow & { subscribers: number }>();
  return (results ?? []).map(({ features_json, ...p }) => ({ ...p, features: parseJsonArray(features_json) }));
}

export async function createPlan(db: D1Database, input: PlanInput, actor: Actor): Promise<{ id: string }> {
  if (await db.prepare("SELECT id FROM plans WHERE code = ?").bind(input.code).first()) fail("CONFLICT", "Plan code already exists");
  const id = `plan-${input.code}`;
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO plans (id, code, name, description, price_monthly_cents, price_yearly_cents, currency, trial_days, max_users, max_branches,
          max_products, max_storage_mb, features_json, is_public, is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .bind(
        id, input.code, input.name, input.description, input.priceMonthlyCents, input.priceYearlyCents, input.currency.toUpperCase(),
        input.trialDays, input.maxUsers, input.maxBranches, input.maxProducts, input.maxStorageMb, JSON.stringify(input.features),
        input.isPublic ? 1 : 0, input.sortOrder, now, now
      ),
    buildPlatformAudit(db, { adminId: actor.id, action: "plan.create", entity: "plan", entityId: id, next: input, ip: actor.ip }),
  ]);
  return { id };
}

/**
 * Editing a plan's list price does not reprice existing subscribers — each
 * subscription locked its price when it was created or last changed. That is
 * deliberate: a price rise is a migration staff run per account, not a side
 * effect of fixing a typo on the pricing page.
 */
export async function editPlan(db: D1Database, id: string, patch: EditPlanInput, actor: Actor): Promise<void> {
  const prev = await db.prepare("SELECT * FROM plans WHERE id = ?").bind(id).first<PlanRow>();
  if (!prev) fail("NOT_FOUND", "Plan not found");
  if (patch.isActive === false) {
    const trialing = await db
      .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = ? AND status = 'TRIALING'")
      .bind(id)
      .first<{ n: number }>();
    if ((trialing?.n ?? 0) > 0) fail("CONFLICT", "Accounts are trialing this plan; move them first");
  }
  const cols: Record<string, unknown> = {
    name: patch.name,
    description: patch.description,
    price_monthly_cents: patch.priceMonthlyCents,
    price_yearly_cents: patch.priceYearlyCents,
    currency: patch.currency?.toUpperCase(),
    trial_days: patch.trialDays,
    max_users: patch.maxUsers,
    max_branches: patch.maxBranches,
    max_products: patch.maxProducts,
    max_storage_mb: patch.maxStorageMb,
    features_json: patch.features ? JSON.stringify(patch.features) : undefined,
    is_public: patch.isPublic === undefined ? undefined : patch.isPublic ? 1 : 0,
    is_active: patch.isActive === undefined ? undefined : patch.isActive ? 1 : 0,
    sort_order: patch.sortOrder,
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (set.length === 0) return;
  await db.batch([
    db.prepare(`UPDATE plans SET ${set.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...set.map(([, v]) => v), Date.now(), id),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: patch.isActive === false ? "plan.archive" : "plan.edit",
      entity: "plan",
      entityId: id,
      prev: Object.fromEntries(set.map(([k]) => [k, (prev as unknown as Record<string, unknown>)[k]])),
      next: Object.fromEntries(set),
      ip: actor.ip,
    }),
  ]);
}

/* ------------------------------------------------------------------ Flags */

export async function listFlags(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM tenant_feature_overrides o WHERE o.flag_key = f.key AND o.enabled = 1) AS forced_on,
              (SELECT COUNT(*) FROM tenant_feature_overrides o WHERE o.flag_key = f.key AND o.enabled = 0) AS forced_off
       FROM feature_flags f ORDER BY f.key`
    )
    .all<{ key: string; description: string; default_enabled: number; rollout_pct: number; forced_on: number; forced_off: number; created_at: number; updated_at: number }>();
  const plans = await listPlans(db);
  return (results ?? []).map((f) => ({ ...f, plans: plans.filter((p) => p.features.includes(f.key)).map((p) => p.code) }));
}

export async function createFlag(
  db: D1Database,
  input: { key: string; description: string; defaultEnabled: boolean; rolloutPct: number },
  actor: Actor
): Promise<void> {
  if (await db.prepare("SELECT key FROM feature_flags WHERE key = ?").bind(input.key).first()) fail("CONFLICT", "Flag already exists");
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO feature_flags (key, description, default_enabled, rollout_pct, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(input.key, input.description, input.defaultEnabled ? 1 : 0, input.rolloutPct, now, now),
    buildPlatformAudit(db, { adminId: actor.id, action: "flag.create", entity: "feature_flag", entityId: input.key, next: input, ip: actor.ip }),
  ]);
}

export async function editFlag(
  db: D1Database,
  key: string,
  patch: { description?: string; defaultEnabled?: boolean; rolloutPct?: number },
  actor: Actor
): Promise<void> {
  const prev = await db.prepare("SELECT * FROM feature_flags WHERE key = ?").bind(key).first<{ description: string; default_enabled: number; rollout_pct: number }>();
  if (!prev) fail("NOT_FOUND", "Flag not found");
  const next = {
    description: patch.description ?? prev.description,
    default_enabled: patch.defaultEnabled === undefined ? prev.default_enabled : patch.defaultEnabled ? 1 : 0,
    rollout_pct: patch.rolloutPct ?? prev.rollout_pct,
  };
  await db.batch([
    db
      .prepare("UPDATE feature_flags SET description = ?, default_enabled = ?, rollout_pct = ?, updated_at = ? WHERE key = ?")
      .bind(next.description, next.default_enabled, next.rollout_pct, Date.now(), key),
    buildPlatformAudit(db, { adminId: actor.id, action: "flag.edit", entity: "feature_flag", entityId: key, prev, next, ip: actor.ip }),
  ]);
}

export async function deleteFlag(db: D1Database, key: string, actor: Actor): Promise<void> {
  const prev = await db.prepare("SELECT * FROM feature_flags WHERE key = ?").bind(key).first();
  if (!prev) fail("NOT_FOUND", "Flag not found");
  const plans = await listPlans(db, { includeArchived: true });
  const using = plans.filter((p) => p.features.includes(key)).map((p) => p.name);
  if (using.length) fail("CONFLICT", `Remove it from these plans first: ${using.join(", ")}`);
  await db.batch([
    db.prepare("DELETE FROM tenant_feature_overrides WHERE flag_key = ?").bind(key),
    db.prepare("DELETE FROM feature_flags WHERE key = ?").bind(key),
    buildPlatformAudit(db, { adminId: actor.id, action: "flag.delete", entity: "feature_flag", entityId: key, prev, ip: actor.ip }),
  ]);
}

/* ------------------------------------------------------------------ Announcements */

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  severity: string;
  audience: string;
  audience_ref: string | null;
  status: string;
  starts_at: number | null;
  ends_at: number | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
};

export async function listAnnouncements(db: D1Database, status?: string): Promise<AnnouncementRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM announcements ${status ? "WHERE status = ?" : ""} ORDER BY COALESCE(published_at, created_at) DESC LIMIT 200`)
    .bind(...(status ? [status] : []))
    .all<AnnouncementRow>();
  return results ?? [];
}

export async function saveAnnouncement(db: D1Database, id: string | null, input: AnnouncementInput, actor: Actor): Promise<{ id: string }> {
  const now = Date.now();
  if (id) {
    const prev = await db.prepare("SELECT * FROM announcements WHERE id = ?").bind(id).first<AnnouncementRow>();
    if (!prev) fail("NOT_FOUND", "Announcement not found");
    if (prev.status === "ARCHIVED") fail("CONFLICT", "Archived announcements are read-only");
    await db.batch([
      db
        .prepare("UPDATE announcements SET title = ?, body = ?, severity = ?, audience = ?, audience_ref = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?")
        .bind(input.title, input.body, input.severity, input.audience, input.audience === "ALL" ? null : input.audienceRef, input.startsAt, input.endsAt, now, id),
      buildPlatformAudit(db, { adminId: actor.id, action: "announcement.edit", entity: "announcement", entityId: id, prev: { title: prev.title, audience: prev.audience }, next: input, ip: actor.ip }),
    ]);
    return { id };
  }
  const newId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO announcements (id, title, body, severity, audience, audience_ref, status, starts_at, ends_at, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)"
      )
      .bind(newId, input.title, input.body, input.severity, input.audience, input.audience === "ALL" ? null : input.audienceRef, input.startsAt, input.endsAt, now, now, actor.id),
    buildPlatformAudit(db, { adminId: actor.id, action: "announcement.create", entity: "announcement", entityId: newId, next: input, ip: actor.ip }),
  ]);
  return { id: newId };
}

export async function setAnnouncementStatus(db: D1Database, id: string, status: "PUBLISHED" | "ARCHIVED" | "DRAFT", actor: Actor): Promise<void> {
  const prev = await db.prepare("SELECT status FROM announcements WHERE id = ?").bind(id).first<{ status: string }>();
  if (!prev) fail("NOT_FOUND", "Announcement not found");
  if (prev.status === status) fail("CONFLICT", `Already ${status.toLowerCase()}`);
  const now = Date.now();
  await db.batch([
    db
      .prepare(`UPDATE announcements SET status = ?, ${status === "PUBLISHED" ? "published_at = ?," : ""} updated_at = ? WHERE id = ?`)
      .bind(...(status === "PUBLISHED" ? [status, now, now, id] : [status, now, id])),
    buildPlatformAudit(db, { adminId: actor.id, action: `announcement.${status.toLowerCase()}`, entity: "announcement", entityId: id, prev, next: { status }, ip: actor.ip }),
  ]);
}

/** Announcements a given account should see right now. */
export async function activeAnnouncementsFor(db: D1Database, tenantId: string, planId: string | null, now = Date.now()) {
  const { results } = await db
    .prepare(
      `SELECT id, title, body, severity, published_at, ends_at FROM announcements
       WHERE status = 'PUBLISHED'
         AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)
         AND (audience = 'ALL' OR (audience = 'TENANT' AND audience_ref = ?) OR (audience = 'PLAN' AND audience_ref = ?))
       ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, published_at DESC LIMIT 5`
    )
    .bind(now, now, tenantId, planId ?? "")
    .all<{ id: string; title: string; body: string; severity: string; published_at: number | null; ends_at: number | null }>();
  return results ?? [];
}
