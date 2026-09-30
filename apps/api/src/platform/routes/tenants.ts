import { Hono } from "hono";
import {
  applyDiscountSchema,
  cancelSubscriptionSchema,
  changePlanSchema,
  createTenantSchema,
  editTenantSchema,
  extendTrialSchema,
  flagOverrideSchema,
  impersonateSchema,
  PLATFORM_PERMISSIONS as P,
  platformReasonSchema,
  tenantNoteSchema,
} from "@goldos/shared";
import { serviceError } from "../../routes/http";
import { requirePlatformAuth, requirePlatformPerm } from "../auth";
import type { PlatformEnv } from "../core";
import { actor, csv, ok, page, parseBody } from "../http";
import { listInvoices } from "../services/billing";
import { createImpersonation, listImpersonations, listPlatformAudit, resolveDataPlane, snapshotUsage } from "../services/ops";
import {
  applyDiscount,
  cancelSubscription,
  changePlan,
  convertTrial,
  extendTrial,
  reactivateSubscription,
  resumeSubscription,
} from "../services/subscriptions";
import {
  addNote,
  archiveTenant,
  createTenant,
  deleteNote,
  editTenant,
  getTenantDetail,
  listTenants,
  loadTenant,
  restoreTenant,
  setFlagOverride,
  suspendTenant,
  tenantsCsv,
  toggleNotePin,
  unsuspendTenant,
} from "../services/tenants";

function filters(c: Parameters<typeof page>[0]) {
  return {
    status: c.req.query("status") || undefined,
    subStatus: c.req.query("subStatus") || undefined,
    planId: c.req.query("planId") || undefined,
    sort: c.req.query("sort") || undefined,
  };
}

/** Reason-only lifecycle actions share one shape. */
function reasonAction(
  perm: string,
  fn: (db: D1Database, id: string, reason: string, a: ReturnType<typeof actor>) => Promise<unknown>
) {
  return [
    requirePlatformPerm(perm),
    async (c: Parameters<typeof page>[0]) => {
      const p = await parseBody(c, platformReasonSchema);
      if (!p.ok) return p.res;
      try {
        return ok(c, (await fn(c.get("pdb"), c.req.param("id") as string, p.data.reason, actor(c))) ?? { ok: true });
      } catch (e) {
        return serviceError(c, e);
      }
    },
  ] as const;
}

export const platformTenants = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.TENANTS_VIEW), async (c) => ok(c, await listTenants(c.get("pdb"), { ...page(c), ...filters(c) })))
  .get("/export.csv", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    const { rows } = await listTenants(c.get("pdb"), { ...filters(c), search: c.req.query("search") || undefined, page: 1, limit: 10000 });
    return csv(tenantsCsv(rows), `accounts-${new Date().toISOString().slice(0, 10)}.csv`);
  })
  .post("/", requirePlatformPerm(P.TENANTS_MANAGE), async (c) => {
    const p = await parseBody(c, createTenantSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await createTenant(c.get("pdb"), p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .get("/:id", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    try {
      return ok(c, await getTenantDetail(c.get("pdb"), c.req.param("id")));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .patch("/:id", requirePlatformPerm(P.TENANTS_MANAGE), async (c) => {
    const p = await parseBody(c, editTenantSchema);
    if (!p.ok) return p.res;
    try {
      await editTenant(c.get("pdb"), c.req.param("id"), p.data, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/suspend", ...reasonAction(P.TENANTS_SUSPEND, suspendTenant))
  .post("/:id/unsuspend", ...reasonAction(P.TENANTS_SUSPEND, unsuspendTenant))
  .post("/:id/archive", ...reasonAction(P.TENANTS_DELETE, archiveTenant))
  .post("/:id/restore", ...reasonAction(P.TENANTS_DELETE, restoreTenant))
  /* ---- notes */
  .post("/:id/notes", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    const p = await parseBody(c, tenantNoteSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await addNote(c.get("pdb"), c.req.param("id"), p.data.body, p.data.pinned, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/notes/:noteId/pin", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    await toggleNotePin(c.get("pdb"), c.req.param("id"), c.req.param("noteId"));
    return ok(c, { ok: true });
  })
  .delete("/:id/notes/:noteId", requirePlatformPerm(P.TENANTS_MANAGE), async (c) => {
    try {
      await deleteNote(c.get("pdb"), c.req.param("id"), c.req.param("noteId"), actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  /* ---- feature overrides */
  .put("/:id/flags", requirePlatformPerm(P.FLAGS_MANAGE), async (c) => {
    const p = await parseBody(c, flagOverrideSchema);
    if (!p.ok) return p.res;
    try {
      await setFlagOverride(c.get("pdb"), c.req.param("id"), p.data.flagKey, p.data.enabled, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  /* ---- subscription */
  .post("/:id/subscription/change-plan", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, changePlanSchema);
    if (!p.ok) return p.res;
    try {
      await changePlan(c.get("pdb"), c.req.param("id"), p.data, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/subscription/extend-trial", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, extendTrialSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await extendTrial(c.get("pdb"), c.req.param("id"), p.data.days, p.data.reason, actor(c)));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/subscription/convert-trial", ...reasonAction(P.BILLING_MANAGE, convertTrial))
  .post("/:id/subscription/resume", ...reasonAction(P.BILLING_MANAGE, resumeSubscription))
  .post("/:id/subscription/reactivate", ...reasonAction(P.BILLING_MANAGE, reactivateSubscription))
  .post("/:id/subscription/cancel", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, cancelSubscriptionSchema);
    if (!p.ok) return p.res;
    try {
      await cancelSubscription(c.get("pdb"), c.req.param("id"), p.data.atPeriodEnd, p.data.reason, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/subscription/discount", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, applyDiscountSchema);
    if (!p.ok) return p.res;
    try {
      await applyDiscount(c.get("pdb"), c.req.param("id"), p.data, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  /* ---- related records */
  .get("/:id/invoices", requirePlatformPerm(P.BILLING_VIEW), async (c) =>
    ok(c, await listInvoices(c.get("pdb"), { tenantId: c.req.param("id"), ...page(c) }))
  )
  .get("/:id/activity", requirePlatformPerm(P.AUDIT_VIEW), async (c) =>
    ok(c, await listPlatformAudit(c.get("pdb"), { tenantId: c.req.param("id"), ...page(c) }))
  )
  .get("/:id/impersonations", requirePlatformPerm(P.TENANTS_IMPERSONATE), async (c) =>
    ok(c, await listImpersonations(c.get("pdb"), c.req.param("id")))
  )
  .post("/:id/impersonate", requirePlatformPerm(P.TENANTS_IMPERSONATE), async (c) => {
    const p = await parseBody(c, impersonateSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await createImpersonation(c.get("pdb"), c.env, c.req.param("id"), p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/usage/refresh", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    try {
      const t = await loadTenant(c.get("pdb"), c.req.param("id"));
      const data = resolveDataPlane(c.env, t);
      if (!data)
        return c.json({ success: false, error: { code: "CONFLICT", message: "This account's data plane is not reachable from this worker" } }, 409);
      return ok(c, await snapshotUsage(c.get("pdb"), data, t.id));
    } catch (e) {
      return serviceError(c, e);
    }
  });
