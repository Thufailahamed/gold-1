import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { limitStatus, tenantTicketSchema, ticketReplySchema } from "@goldos/shared";
import { z } from "zod";
import type { Env } from "../db/client";
import { extractSessionId, requireAuth, type AppVariables } from "../middleware/auth";
import { writeAudit } from "../middleware/audit";
import { serviceError } from "../routes/http";
import { sessionCookie } from "../routes/auth";
import { createSession } from "../services/session";
import { getPlatformSettings, parseJsonArray, sha256Hex } from "./core";
import { activeAnnouncementsFor } from "./services/catalog";
import { createTicket, getTicket, listTickets, replyToTicket } from "./services/support";
import { tenantFlags } from "./services/tenants";
import type { PlanRow, SubRow } from "./services/subcore";

type TenantEnv = { Bindings: Env; Variables: AppVariables };

/* ------------------------------------------------------------------ Gate */

type GateState = { status: string; reason: string | null; maintenance: boolean; maintenanceMessage: string };
const GATE_TTL_MS = 30_000;
let gateCache: { at: number; tenantId: string; value: GateState | null } | null = null;

/** For tests and for the portal's own writes to take effect without waiting out the cache. */
export function resetGateCache(): void {
  gateCache = null;
}

async function gateState(env: Env): Promise<GateState | null> {
  if (!env.PLATFORM_DB || !env.TENANT_ID) return null;
  const now = Date.now();
  if (gateCache && gateCache.tenantId === env.TENANT_ID && now - gateCache.at < GATE_TTL_MS) return gateCache.value;
  const t = await env.PLATFORM_DB.prepare("SELECT status, suspended_reason FROM tenants WHERE id = ?")
    .bind(env.TENANT_ID)
    .first<{ status: string; suspended_reason: string | null }>();
  const settings = await getPlatformSettings(env.PLATFORM_DB);
  const value = t
    ? { status: t.status, reason: t.suspended_reason, maintenance: settings.maintenance_mode, maintenanceMessage: settings.maintenance_message }
    : null;
  gateCache = { at: now, tenantId: env.TENANT_ID, value };
  return value;
}

const GATE_EXEMPT = ["/api/v1/health", "/api/v1/platform/context", "/api/v1/auth/logout"];

/**
 * Stops a suspended or archived shop from using the product, and every shop
 * during platform maintenance. Unmanaged deployments (no PLATFORM_DB or no
 * TENANT_ID) pass straight through, so a single-shop install behaves exactly
 * as before. Status is cached per isolate for 30s: a suspension lands within
 * half a minute, and the common path costs no extra query.
 */
export const tenantGate = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.req.method === "OPTIONS" || GATE_EXEMPT.some((p) => c.req.path.startsWith(p))) return next();
  const state = await gateState(c.env);
  if (!state) return next();
  if (state.maintenance)
    return c.json(
      { success: false, error: { code: "MAINTENANCE", message: state.maintenanceMessage || "Scheduled maintenance in progress. Please try again shortly." } },
      503
    );
  if (state.status === "SUSPENDED")
    return c.json(
      { success: false, error: { code: "TENANT_SUSPENDED", message: "This workspace is suspended. Contact support to restore access." } },
      403
    );
  if (state.status === "ARCHIVED")
    return c.json({ success: false, error: { code: "TENANT_ARCHIVED", message: "This workspace has been closed." } }, 403);
  return next();
});

/* ------------------------------------------------------------------ Limits */

type Metered = "users" | "branches" | "products";

const COUNT_SQL: Record<Metered, string> = {
  users: "SELECT COUNT(*) AS n FROM users WHERE is_active = 1",
  branches: "SELECT COUNT(*) AS n FROM branches WHERE is_active = 1",
  products: "SELECT COUNT(*) AS n FROM products WHERE status NOT IN ('SOLD','MELTED','VOID','LOST')",
};

const LIMIT_COL: Record<Metered, "max_users" | "max_branches" | "max_products"> = {
  users: "max_users",
  branches: "max_branches",
  products: "max_products",
};

async function currentPlan(env: Env): Promise<{ sub: SubRow; plan: PlanRow } | null> {
  if (!env.PLATFORM_DB || !env.TENANT_ID) return null;
  const sub = await env.PLATFORM_DB.prepare("SELECT * FROM subscriptions WHERE tenant_id = ?").bind(env.TENANT_ID).first<SubRow>();
  if (!sub) return null;
  const plan = await env.PLATFORM_DB.prepare("SELECT * FROM plans WHERE id = ?").bind(sub.plan_id).first<PlanRow>();
  return plan ? { sub, plan } : null;
}

/** Refuses a create that would take the shop past its plan's limit. */
export const enforcePlanLimit = (what: Metered) =>
  createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const cur = await currentPlan(c.env);
    const max = cur?.plan[LIMIT_COL[what]];
    if (max === null || max === undefined) return next();
    const used = (await c.env.DB.prepare(COUNT_SQL[what]).first<{ n: number }>())?.n ?? 0;
    if (used >= max)
      return c.json(
        {
          success: false,
          error: { code: "PLAN_LIMIT", message: `Your ${cur!.plan.name} plan allows ${max} ${what}. Upgrade to add more.` },
        },
        403
      );
    return next();
  });

/* ------------------------------------------------------------------ Tenant-facing routes */

const consumeSchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

async function me(env: Env, userId: string) {
  return env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(userId).first<{ id: string; email: string; name: string }>();
}

export const platformBridge = new Hono<TenantEnv>()
  /**
   * What the shop app shows about its own account: plan, trial clock,
   * entitlements, limits and live announcements. Unauthenticated callers get
   * status only, so the login page can explain a suspension.
   */
  .get("/context", async (c) => {
    const pdb = c.env.PLATFORM_DB;
    if (!pdb || !c.env.TENANT_ID) return c.json({ success: true, data: { managed: false } }, 200);
    const tenant = await pdb
      .prepare("SELECT id, name, slug, status, suspended_reason FROM tenants WHERE id = ?")
      .bind(c.env.TENANT_ID)
      .first<{ id: string; name: string; slug: string; status: string; suspended_reason: string | null }>();
    if (!tenant) return c.json({ success: true, data: { managed: false } }, 200);
    const settings = await getPlatformSettings(pdb);
    const cur = await currentPlan(c.env);
    const base = {
      managed: true,
      tenant: { name: tenant.name, slug: tenant.slug, status: tenant.status },
      maintenance: settings.maintenance_mode ? settings.maintenance_message || "Scheduled maintenance in progress." : null,
      supportEmail: settings.support_email,
    };
    // Detailed commercial context is for signed-in users only.
    const authed = await requireAuthProbe(c);
    if (!authed) return c.json({ success: true, data: base }, 200);
    const counts = {
      users: (await c.env.DB.prepare(COUNT_SQL.users).first<{ n: number }>())?.n ?? 0,
      branches: (await c.env.DB.prepare(COUNT_SQL.branches).first<{ n: number }>())?.n ?? 0,
      products: (await c.env.DB.prepare(COUNT_SQL.products).first<{ n: number }>())?.n ?? 0,
    };
    const openInvoices = await pdb
      .prepare("SELECT COUNT(*) AS n, COALESCE(MIN(due_at), 0) AS first_due, COALESCE(SUM(total_cents - amount_paid_cents), 0) AS balance FROM invoices WHERE tenant_id = ? AND status = 'OPEN'")
      .bind(tenant.id)
      .first<{ n: number; first_due: number; balance: number }>();
    const flags = await tenantFlags(pdb, tenant.id, cur?.plan ?? null);
    return c.json(
      {
        success: true,
        data: {
          ...base,
          subscription: cur
            ? {
                plan: cur.plan.name,
                planCode: cur.plan.code,
                status: cur.sub.status,
                interval: cur.sub.billing_interval,
                trialEndsAt: cur.sub.trial_ends_at,
                currentPeriodEnd: cur.sub.current_period_end,
                cancelAtPeriodEnd: cur.sub.cancel_at_period_end === 1,
              }
            : null,
          billing: { openInvoices: openInvoices?.n ?? 0, balanceCents: openInvoices?.balance ?? 0, firstDueAt: openInvoices?.first_due || null },
          limits: cur
            ? {
                users: { used: counts.users, max: cur.plan.max_users, ...limitStatus(counts.users, cur.plan.max_users) },
                branches: { used: counts.branches, max: cur.plan.max_branches, ...limitStatus(counts.branches, cur.plan.max_branches) },
                products: { used: counts.products, max: cur.plan.max_products, ...limitStatus(counts.products, cur.plan.max_products) },
              }
            : null,
          features: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
          planFeatures: cur ? parseJsonArray(cur.plan.features_json) : [],
          announcements: await activeAnnouncementsFor(pdb, tenant.id, cur?.plan.id ?? null),
        },
      },
      200
    );
  })
  .get("/support", requireAuth, async (c) => {
    if (!c.env.PLATFORM_DB || !c.env.TENANT_ID) return c.json({ success: true, data: { rows: [], total: 0 } }, 200);
    const { rows, total } = await listTickets(c.env.PLATFORM_DB, { tenantId: c.env.TENANT_ID, page: 1, limit: 50 });
    return c.json({ success: true, data: { rows, total } }, 200);
  })
  .get("/support/:id", requireAuth, async (c) => {
    if (!c.env.PLATFORM_DB || !c.env.TENANT_ID) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    try {
      const t = await getTicket(c.env.PLATFORM_DB, c.req.param("id"), { includeInternal: false });
      if (t.ticket.tenant_id !== c.env.TENANT_ID) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      return c.json({ success: true, data: t }, 200);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/support", requireAuth, async (c) => {
    if (!c.env.PLATFORM_DB || !c.env.TENANT_ID)
      return c.json({ success: false, error: { code: "UNAVAILABLE", message: "Support is not available on this deployment" } }, 503);
    const parsed = tenantTicketSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Subject and message are required" } }, 400);
    const user = await me(c.env, c.get("userId"));
    if (!user) return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Session expired" } }, 401);
    try {
      const r = await createTicket(
        c.env.PLATFORM_DB,
        { ...parsed.data, tenantId: c.env.TENANT_ID, requesterEmail: user.email },
        { type: "TENANT", id: user.id, name: user.name },
        null
      );
      return c.json({ success: true, data: r }, 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/support/:id/replies", requireAuth, async (c) => {
    if (!c.env.PLATFORM_DB || !c.env.TENANT_ID) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const parsed = ticketReplySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Message is required" } }, 400);
    const user = await me(c.env, c.get("userId"));
    if (!user) return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "Session expired" } }, 401);
    try {
      const t = await getTicket(c.env.PLATFORM_DB, c.req.param("id"), { includeInternal: false });
      if (t.ticket.tenant_id !== c.env.TENANT_ID) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      await replyToTicket(c.env.PLATFORM_DB, t.ticket.id, { body: parsed.data.body, internal: false }, { type: "TENANT", id: user.id, name: user.name }, null);
      return c.json({ success: true, data: { ok: true } }, 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  /**
   * Redeems a staff impersonation link. The grant must be for THIS data
   * plane's tenant, unexpired and unused; redemption is a single guarded
   * UPDATE … RETURNING, so a link cannot be replayed even in a race. The
   * resulting session is capped at one hour and the shop's own audit log
   * records who really signed in.
   */
  .post("/impersonate", async (c) => {
    const pdb = c.env.PLATFORM_DB;
    if (!pdb || !c.env.TENANT_ID) return c.json({ success: false, error: { code: "UNAVAILABLE", message: "Not available" } }, 503);
    const parsed = consumeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid link" } }, 400);
    const now = Date.now();
    const invalid = () =>
      c.json({ success: false, error: { code: "UNAUTHORIZED", message: "This link is invalid, expired or already used" } }, 401);
    const tokenHash = await sha256Hex(parsed.data.token);
    const found = await pdb
      .prepare("SELECT id, target_email FROM impersonation_grants WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? AND tenant_id = ?")
      .bind(tokenHash, now, c.env.TENANT_ID)
      .first<{ id: string; target_email: string }>();
    if (!found) return invalid();
    // Resolve the user before redeeming, so a mistyped target does not burn the link.
    const user = await c.env.DB.prepare("SELECT id, email, name FROM users WHERE email = ? AND is_active = 1")
      .bind(found.target_email)
      .first<{ id: string; email: string; name: string }>();
    if (!user) return c.json({ success: false, error: { code: "NOT_FOUND", message: `No active user ${found.target_email} in this workspace` } }, 404);
    const grant = await pdb
      .prepare(
        `UPDATE impersonation_grants SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
         RETURNING id, admin_id, target_email, reason`
      )
      .bind(now, found.id, now)
      .first<{ id: string; admin_id: string; target_email: string; reason: string }>();
    if (!grant) return invalid();
    const staff = await pdb.prepare("SELECT name, email FROM platform_admins WHERE id = ?").bind(grant.admin_id).first<{ name: string; email: string }>();
    const session = await createSession(c.env.DB, user.id);
    const maxAge = 60 * 60;
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(now + maxAge * 1000, session.id).run();
    await writeAudit(c.env.DB, {
      userId: user.id,
      action: "auth.impersonate",
      entity: "session",
      entityId: session.id,
      reason: `Platform staff ${staff?.name ?? "unknown"} <${staff?.email ?? "?"}>: ${grant.reason}`,
      ip: c.req.header("cf-connecting-ip") ?? undefined,
    });
    await pdb
      .prepare(
        "INSERT INTO platform_audit_logs (id, admin_id, action, entity, entity_id, tenant_id, reason, ip, created_at) VALUES (?, ?, 'tenant.impersonate_consumed', 'impersonation_grant', ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), grant.admin_id, grant.id, c.env.TENANT_ID, `Signed in as ${user.email}`, c.req.header("cf-connecting-ip") ?? null, now)
      .run();
    c.header("Set-Cookie", sessionCookie(session.id, maxAge));
    return c.json({ success: true, data: { user: { id: user.id, email: user.email, name: user.name }, impersonatedBy: staff?.name ?? null } }, 200);
  });

/** Checks for a valid shop session without failing the request when there isn't one. */
async function requireAuthProbe(c: { req: { header: (n: string) => string | undefined }; env: Env }): Promise<boolean> {
  const sid = extractSessionId(c);
  if (!sid) return false;
  const row = await c.env.DB.prepare("SELECT s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND u.is_active = 1")
    .bind(sid)
    .first<{ expires_at: number }>();
  return !!row && row.expires_at > Date.now();
}
