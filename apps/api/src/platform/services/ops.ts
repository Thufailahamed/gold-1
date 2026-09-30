import { DAY_MS, PLATFORM_SETTING_DEFAULTS } from "@goldos/shared";
import type { Env } from "../../db/client";
import { buildPlatformAudit, fail, getPlatformSettings, randomToken, sha256Hex, type Actor } from "../core";
import { loadTenant } from "./tenants";

/* ------------------------------------------------------------------ Settings */

export async function updatePlatformSettings(db: D1Database, patch: Record<string, unknown>, actor: Actor): Promise<void> {
  const prev = await getPlatformSettings(db);
  const entries = Object.entries(patch).filter(([k, v]) => k in PLATFORM_SETTING_DEFAULTS && v !== undefined);
  if (entries.length === 0) return;
  const now = Date.now();
  await db.batch([
    ...entries.map(([k, v]) =>
      db
        .prepare(
          "INSERT INTO platform_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
        )
        .bind(k, JSON.stringify(v), now, actor.id)
    ),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "settings.update",
      entity: "platform_settings",
      entityId: "platform",
      prev: Object.fromEntries(entries.map(([k]) => [k, (prev as Record<string, unknown>)[k]])),
      next: Object.fromEntries(entries),
      ip: actor.ip,
    }),
  ]);
}

/* ------------------------------------------------------------------ Audit */

export type AuditFilter = {
  adminId?: string;
  tenantId?: string;
  action?: string;
  entity?: string;
  from?: number;
  to?: number;
  search?: string;
  page: number;
  limit: number;
};

export async function listPlatformAudit(db: D1Database, f: AuditFilter) {
  const where: string[] = [];
  const binds: unknown[] = [];
  const eq: Array<[string, unknown]> = [
    ["l.admin_id = ?", f.adminId],
    ["l.tenant_id = ?", f.tenantId],
    ["l.action LIKE ?", f.action ? `${f.action}%` : undefined],
    ["l.entity = ?", f.entity],
    ["l.created_at >= ?", f.from],
    ["l.created_at < ?", f.to],
  ];
  for (const [clause, value] of eq) {
    if (value === undefined || value === "") continue;
    where.push(clause);
    binds.push(value);
  }
  if (f.search) {
    where.push("(l.action LIKE ? OR l.entity_id LIKE ? OR l.reason LIKE ? OR t.name LIKE ?)");
    const like = `%${f.search}%`;
    binds.push(like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM platform_audit_logs l LEFT JOIN tenants t ON t.id = l.tenant_id ${w}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT l.id, l.admin_id, a.name AS admin_name, a.email AS admin_email, l.action, l.entity, l.entity_id, l.tenant_id, t.name AS tenant_name,
              l.prev_json, l.new_json, l.reason, l.ip, l.created_at
       FROM platform_audit_logs l LEFT JOIN platform_admins a ON a.id = l.admin_id LEFT JOIN tenants t ON t.id = l.tenant_id
       ${w} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...binds, f.limit, (f.page - 1) * f.limit)
    .all<Record<string, unknown>>();
  return { rows: results ?? [], total: total?.n ?? 0 };
}

export function auditCsv(rows: Record<string, unknown>[]): string {
  const cols = ["created_at", "admin_email", "action", "entity", "entity_id", "tenant_name", "reason", "ip", "prev_json", "new_json"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => (c === "created_at" ? new Date(Number(r[c])).toISOString() : esc(r[c]))).join(",")),
  ].join("\n");
}

/* ------------------------------------------------------------------ Jobs */

export const JOBS = ["billing_cycle", "collect_usage", "housekeeping"] as const;
export type JobName = (typeof JOBS)[number];

/** Records every run — cron or button — so the System page can show what ran and what broke. */
export async function runJob<T>(
  db: D1Database,
  job: JobName,
  trigger: "cron" | "manual",
  by: string | null,
  fn: () => Promise<T>
): Promise<T> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO job_runs (id, job, trigger, status, started_at, triggered_by) VALUES (?, ?, ?, 'RUNNING', ?, ?)")
    .bind(id, job, trigger, Date.now(), by)
    .run();
  try {
    const result = await fn();
    await db
      .prepare("UPDATE job_runs SET status = 'OK', summary_json = ?, finished_at = ? WHERE id = ?")
      .bind(JSON.stringify(result ?? null), Date.now(), id)
      .run();
    return result;
  } catch (e) {
    await db
      .prepare("UPDATE job_runs SET status = 'FAILED', error = ?, finished_at = ? WHERE id = ?")
      .bind(e instanceof Error ? e.message : String(e), Date.now(), id)
      .run();
    throw e;
  }
}

export async function listJobRuns(db: D1Database, job?: string) {
  const { results } = await db
    .prepare(
      `SELECT r.*, a.name AS triggered_by_name FROM job_runs r LEFT JOIN platform_admins a ON a.id = r.triggered_by
       ${job ? "WHERE r.job = ?" : ""} ORDER BY r.started_at DESC LIMIT 50`
    )
    .bind(...(job ? [job] : []))
    .all();
  return results ?? [];
}

export async function housekeeping(db: D1Database, now = Date.now()) {
  const sessions = await db.prepare("DELETE FROM platform_sessions WHERE expires_at < ?").bind(now).run();
  const grants = await db
    .prepare("DELETE FROM impersonation_grants WHERE expires_at < ? AND created_at < ?")
    .bind(now, now - 90 * DAY_MS)
    .run();
  const jobs = await db.prepare("DELETE FROM job_runs WHERE started_at < ?").bind(now - 90 * DAY_MS).run();
  return {
    sessionsPurged: sessions.meta?.changes ?? 0,
    grantsPurged: grants.meta?.changes ?? 0,
    jobRunsPurged: jobs.meta?.changes ?? 0,
  };
}

/* ------------------------------------------------------------------ Usage */

function isD1(x: unknown): x is D1Database {
  return typeof x === "object" && x !== null && typeof (x as { prepare?: unknown }).prepare === "function";
}

/**
 * Finds the data-plane database for an account: `tenants.data_plane` names a
 * D1 binding on this worker (e.g. "DB_KANDY"); the account in TENANT_ID is
 * served by the default DB binding. Anything else is not reachable from here.
 */
export function resolveDataPlane(env: Env, tenant: { id: string; data_plane: string | null }): D1Database | null {
  if (tenant.data_plane) {
    const b = (env as unknown as Record<string, unknown>)[tenant.data_plane];
    if (isD1(b)) return b;
  }
  if (env.TENANT_ID && env.TENANT_ID === tenant.id) return env.DB;
  return null;
}

export async function snapshotUsage(pdb: D1Database, data: D1Database, tenantId: string, now = Date.now()) {
  const n = async (sql: string, ...binds: unknown[]) =>
    (await data.prepare(sql).bind(...binds).first<{ n: number | null }>())?.n ?? 0;
  const since = now - 30 * DAY_MS;
  const users = await n("SELECT COUNT(*) AS n FROM users WHERE is_active = 1");
  const branches = await n("SELECT COUNT(*) AS n FROM branches WHERE is_active = 1");
  const products = await n("SELECT COUNT(*) AS n FROM products WHERE status NOT IN ('SOLD','MELTED','VOID','LOST')");
  const sales = await n("SELECT COUNT(*) AS n FROM sales_invoices WHERE created_at >= ? AND status != 'VOID'", since);
  const salesCents = await n("SELECT COALESCE(SUM(total_cents), 0) AS n FROM sales_invoices WHERE created_at >= ? AND status != 'VOID'", since);
  const lastActive = (await data.prepare("SELECT MAX(created_at) AS n FROM audit_logs").first<{ n: number | null }>())?.n ?? null;
  const snap = { users, branches, products, sales_30d: sales, sales_30d_cents: salesCents, storage_mb: 0, last_active_at: lastActive };
  await pdb.batch([
    pdb
      .prepare(
        "INSERT INTO usage_snapshots (id, tenant_id, users, branches, products, sales_30d, sales_30d_cents, storage_mb, last_active_at, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), tenantId, users, branches, products, sales, salesCents, 0, lastActive, now),
    pdb.prepare("UPDATE tenants SET last_active_at = COALESCE(?, last_active_at) WHERE id = ?").bind(lastActive, tenantId),
    // Keep ~90 days of history per account.
    pdb.prepare("DELETE FROM usage_snapshots WHERE tenant_id = ? AND captured_at < ?").bind(tenantId, now - 90 * DAY_MS),
  ]);
  return snap;
}

export async function collectAllUsage(pdb: D1Database, env: Env) {
  const { results } = await pdb
    .prepare("SELECT id, data_plane FROM tenants WHERE status != 'ARCHIVED'")
    .all<{ id: string; data_plane: string | null }>();
  let collected = 0;
  let unreachable = 0;
  const errors: Array<{ tenantId: string; message: string }> = [];
  for (const t of results ?? []) {
    const data = resolveDataPlane(env, t);
    if (!data) {
      unreachable++;
      continue;
    }
    try {
      await snapshotUsage(pdb, data, t.id);
      collected++;
    } catch (e) {
      errors.push({ tenantId: t.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { collected, unreachable, errors };
}

/* ------------------------------------------------------------------ Impersonation */

/**
 * Issues a single-use sign-in link into a shop, as one of its users. The
 * token is shown once; only its hash is stored, it expires in minutes, the
 * shop's own audit log records the sign-in against the staff member, and a
 * reason is mandatory.
 */
export async function createImpersonation(
  db: D1Database,
  env: Env,
  tenantId: string,
  input: { targetEmail?: string; reason: string },
  actor: Actor
): Promise<{ url: string; expiresAt: number; targetEmail: string }> {
  const tenant = await loadTenant(db, tenantId);
  if (tenant.status === "ARCHIVED") fail("CONFLICT", "Account is archived");
  const settings = await getPlatformSettings(db);
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + settings.impersonation_ttl_minutes * 60 * 1000;
  const target = (input.targetEmail ?? tenant.owner_email).toLowerCase();
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO impersonation_grants (id, token_hash, tenant_id, admin_id, target_email, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, await sha256Hex(token), tenant.id, actor.id, target, input.reason, expiresAt, now),
    buildPlatformAudit(db, {
      adminId: actor.id,
      action: "tenant.impersonate",
      entity: "impersonation_grant",
      entityId: id,
      tenantId: tenant.id,
      next: { targetEmail: target, expiresAt },
      reason: input.reason,
      ip: actor.ip,
    }),
  ]);
  const origin = tenant.custom_domain
    ? `https://${tenant.custom_domain}`
    : (env.WEB_ORIGIN ?? "http://localhost:3000").split(",")[0]!.trim();
  return { url: `${origin}/impersonate?token=${token}`, expiresAt, targetEmail: target };
}

export async function listImpersonations(db: D1Database, tenantId: string) {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.target_email, g.reason, g.expires_at, g.consumed_at, g.created_at, a.name AS admin_name
       FROM impersonation_grants g JOIN platform_admins a ON a.id = g.admin_id WHERE g.tenant_id = ? ORDER BY g.created_at DESC LIMIT 20`
    )
    .bind(tenantId)
    .all();
  return results ?? [];
}

/* ------------------------------------------------------------------ System */

async function ping(db: D1Database | undefined): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> {
  if (!db) return { ok: false, latencyMs: null, error: "Not bound" };
  const t0 = Date.now();
  try {
    await db.prepare("SELECT 1 AS ok").first();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function systemHealth(pdb: D1Database, env: Env) {
  const [control, data] = await Promise.all([ping(pdb), ping(env.DB)]);
  const counts: Record<string, number> = {};
  for (const table of ["tenants", "subscriptions", "invoices", "payments", "support_tickets", "platform_audit_logs", "usage_snapshots", "platform_sessions"]) {
    counts[table] = (await pdb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;
  }
  const lastRuns: Record<string, unknown> = {};
  for (const job of JOBS) {
    lastRuns[job] = await pdb
      .prepare("SELECT id, status, trigger, started_at, finished_at, error, summary_json FROM job_runs WHERE job = ? ORDER BY started_at DESC LIMIT 1")
      .bind(job)
      .first();
  }
  const failures24h = await pdb
    .prepare("SELECT COUNT(*) AS n FROM job_runs WHERE status = 'FAILED' AND started_at >= ?")
    .bind(Date.now() - DAY_MS)
    .first<{ n: number }>();
  const liveSessions = await pdb
    .prepare("SELECT COUNT(DISTINCT admin_id) AS n FROM platform_sessions WHERE expires_at > ? AND mfa_pending = 0")
    .bind(Date.now())
    .first<{ n: number }>();
  const settings = await getPlatformSettings(pdb);
  return {
    databases: { control, data },
    counts,
    lastRuns,
    jobFailures24h: failures24h?.n ?? 0,
    staffOnline: liveSessions?.n ?? 0,
    config: {
      tenantBound: env.TENANT_ID ?? null,
      bootstrapTokenSet: !!env.PLATFORM_BOOTSTRAP_TOKEN,
      webOrigins: (env.WEB_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      r2Bound: !!env.R2,
      maintenanceMode: settings.maintenance_mode,
      signupEnabled: settings.signup_enabled,
    },
    serverTime: Date.now(),
  };
}
