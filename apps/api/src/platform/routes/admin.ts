import { Hono } from "hono";
import { z } from "zod";
import {
  createPlatformAdminSchema,
  editPlatformAdminSchema,
  PLATFORM_PERMISSIONS as P,
  PLATFORM_ROLES,
  platformReasonSchema,
  platformSettingsSchema,
} from "@goldos/shared";
import { serviceError } from "../../routes/http";
import { requirePlatformAuth, requirePlatformPerm } from "../auth";
import { getPlatformSettings, type PlatformEnv } from "../core";
import { actor, csv, ok, page, parseBody } from "../http";
import {
  createAdmin,
  editAdmin,
  listAdmins,
  resetAdminMfa,
  resetAdminPassword,
  revokeAllSessions,
  setAdminActive,
} from "../services/admins";
import { runBillingCycle } from "../services/billing";
import { platformOverview } from "../services/metrics";
import {
  auditCsv,
  collectAllUsage,
  housekeeping,
  JOBS,
  listJobRuns,
  listPlatformAudit,
  runJob,
  systemHealth,
  updatePlatformSettings,
  type JobName,
} from "../services/ops";

const passwordResetSchema = z.object({ password: z.string().min(12) });

export const platformOverviewRoutes = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.TENANTS_VIEW), async (c) => ok(c, await platformOverview(c.get("pdb"))));

export const platformTeam = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/roles", requirePlatformPerm(P.ADMINS_VIEW), (c) =>
    ok(c, Object.entries(PLATFORM_ROLES).map(([key, r]) => ({ key, label: r.label, description: r.description, permissions: r.permissions })))
  )
  .get("/", requirePlatformPerm(P.ADMINS_VIEW), async (c) => ok(c, await listAdmins(c.get("pdb"))))
  .post("/", requirePlatformPerm(P.ADMINS_MANAGE), async (c) => {
    const p = await parseBody(c, createPlatformAdminSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await createAdmin(c.get("pdb"), p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .patch("/:id", requirePlatformPerm(P.ADMINS_MANAGE), async (c) => {
    const p = await parseBody(c, editPlatformAdminSchema);
    if (!p.ok) return p.res;
    try {
      await editAdmin(c.get("pdb"), c.req.param("id"), p.data, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/:state{activate|deactivate}", requirePlatformPerm(P.ADMINS_MANAGE), async (c) => {
    const p = await parseBody(c, platformReasonSchema);
    if (!p.ok) return p.res;
    try {
      await setAdminActive(c.get("pdb"), c.req.param("id"), c.req.param("state") === "activate", p.data.reason, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/reset-password", requirePlatformPerm(P.ADMINS_MANAGE), async (c) => {
    const p = await parseBody(c, passwordResetSchema);
    if (!p.ok) return p.res;
    try {
      await resetAdminPassword(c.get("pdb"), c.req.param("id"), p.data.password, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/reset-mfa", requirePlatformPerm(P.ADMINS_MANAGE), async (c) => {
    const p = await parseBody(c, platformReasonSchema);
    if (!p.ok) return p.res;
    try {
      await resetAdminMfa(c.get("pdb"), c.req.param("id"), p.data.reason, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/revoke-sessions", requirePlatformPerm(P.ADMINS_MANAGE), async (c) => {
    await revokeAllSessions(c.get("pdb"), c.req.param("id"), actor(c));
    return ok(c, { ok: true });
  });

function auditFilter(c: Parameters<typeof page>[0]) {
  const num = (k: string) => {
    const v = Number(c.req.query(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  return {
    adminId: c.req.query("adminId") || undefined,
    tenantId: c.req.query("tenantId") || undefined,
    action: c.req.query("action") || undefined,
    entity: c.req.query("entity") || undefined,
    from: num("from"),
    to: num("to"),
  };
}

export const platformAudit = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.AUDIT_VIEW), async (c) => ok(c, await listPlatformAudit(c.get("pdb"), { ...page(c), ...auditFilter(c) })))
  .get("/export.csv", requirePlatformPerm(P.AUDIT_VIEW), async (c) => {
    const { rows } = await listPlatformAudit(c.get("pdb"), { ...auditFilter(c), search: c.req.query("search") || undefined, page: 1, limit: 10000 });
    return csv(auditCsv(rows), `platform-audit-${new Date().toISOString().slice(0, 10)}.csv`);
  });

export const platformSystem = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/health", requirePlatformPerm(P.SYSTEM_VIEW), async (c) => ok(c, await systemHealth(c.get("pdb"), c.env)))
  .get("/jobs", requirePlatformPerm(P.SYSTEM_VIEW), async (c) => ok(c, await listJobRuns(c.get("pdb"), c.req.query("job") || undefined)))
  .post("/jobs/:job/run", requirePlatformPerm(P.SETTINGS_MANAGE), async (c) => {
    const job = c.req.param("job") as JobName;
    if (!JOBS.includes(job)) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Unknown job" } }, 404);
    const pdb = c.get("pdb");
    const by = c.get("adminId");
    try {
      const fn: () => Promise<unknown> = {
        billing_cycle: () => runBillingCycle(pdb, by),
        collect_usage: () => collectAllUsage(pdb, c.env),
        housekeeping: () => housekeeping(pdb),
      }[job];
      return ok(c, await runJob(pdb, job, "manual", by, fn));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .get("/settings", requirePlatformPerm(P.SYSTEM_VIEW), async (c) => ok(c, await getPlatformSettings(c.get("pdb"))))
  .patch("/settings", requirePlatformPerm(P.SETTINGS_MANAGE), async (c) => {
    const p = await parseBody(c, platformSettingsSchema);
    if (!p.ok) return p.res;
    try {
      await updatePlatformSettings(c.get("pdb"), p.data, actor(c));
      return ok(c, await getPlatformSettings(c.get("pdb")));
    } catch (e) {
      return serviceError(c, e);
    }
  });
