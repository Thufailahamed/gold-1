import { Hono } from "hono";
import { z } from "zod";
import {
  applyDiscountSchema,
  bulkTenantActionSchema,
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
import { randomToken } from "../core";
import { provisionShop, retryProvision } from "../provision";
import { actor, csv, ok, page, parseBody } from "../http";
import { listInvoices } from "../services/billing";
import { createImpersonation, listActiveImpersonations, listImpersonations, listPlatformAudit, resolveDataPlane, revokeAllImpersonations, revokeImpersonation, snapshotUsage } from "../services/ops";
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
  bulkTenants,
  createTenant,
  deleteNote,
  editTenant,
  exportTenant,
  getTenantDetail,
  listTenants,
  loadTenant,
  purgeTenant,
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
  .post("/bulk", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    const p = await parseBody(c, bulkTenantActionSchema);
    if (!p.ok) return p.res;
    // Bulk re-checks the specific perm for the action — viewing alone is not enough.
    const need =
      p.data.action === "suspend" || p.data.action === "unsuspend" ? P.TENANTS_SUSPEND
      : p.data.action === "archive" || p.data.action === "restore" ? P.TENANTS_DELETE
      : P.BILLING_MANAGE;
    if (!(c.get("platformPermissions") ?? []).includes(need))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "Missing permission" } }, 403);
    try {
      return ok(c, await bulkTenants(c.get("pdb"), p.data, actor(c)));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/", requirePlatformPerm(P.TENANTS_MANAGE), async (c) => {
    const p = await parseBody(c, createTenantSchema);
    if (!p.ok) return p.res;
    try {
      const created = await createTenant(c.get("pdb"), p.data, actor(c));
      // Staff-created shops provision down the same path as self-signup. The
      // temp password is shown once — it is never stored.
      const tempPassword = randomToken(12).slice(0, 16);
      try {
        const tenant = await loadTenant(c.get("pdb"), created.id);
        const out = await provisionShop(c.env, c.get("pdb"), {
          tenantId: created.id,
          slug: tenant.slug,
          shopName: tenant.name,
          ownerName: tenant.owner_name,
          ownerEmail: tenant.owner_email,
          password: tempPassword,
          country: tenant.country,
          currency: tenant.currency,
          timezone: tenant.timezone,
        });
        return ok(c, { ...created, provisioning: { status: "ready", ...out }, tempPassword }, 201);
      } catch (e) {
        return ok(c, { ...created, provisioning: { status: "failed", error: e instanceof Error ? e.message : String(e) }, tempPassword: null }, 201);
      }
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/retry-provision", requirePlatformPerm(P.TENANTS_MANAGE), async (c) => {
    const p = await parseBody(c, z.object({ ownerEmail: z.string().email(), tempPassword: z.string().min(10).max(200) }));
    if (!p.ok) return p.res;
    try {
      const out = await retryProvision(c.env, c.get("pdb"), c.req.param("id"), p.data);
      return ok(c, { provisioning: { status: "ready", ...out } }, 200);
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
  })
  .get("/:id/export.json", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    try {
      const full = await exportTenant(c.get("pdb"), c.req.param("id"));
      // Export respects the same section perms as the rest of the console:
      // billing / tickets / audit are stripped without their view perms.
      const perms: string[] = c.get("platformPermissions") ?? [];
      const { invoices, payments, tickets, audit, ...rest } = full as typeof full & { invoices: unknown[]; payments: unknown[]; tickets: unknown[]; audit: unknown[] };
      return ok(c, {
        ...rest,
        invoices: perms.includes(P.BILLING_VIEW) ? invoices : [],
        payments: perms.includes(P.BILLING_VIEW) ? payments : [],
        tickets: perms.includes(P.SUPPORT_VIEW) ? tickets : [],
        audit: perms.includes(P.AUDIT_VIEW) ? audit : [],
      });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .delete("/:id/purge", requirePlatformPerm(P.TENANTS_DELETE), async (c) => {
    const p = await parseBody(c, platformReasonSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await purgeTenant(c.get("pdb"), c.req.param("id"), p.data.reason, actor(c)));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .delete("/:id/impersonations", requirePlatformPerm(P.TENANTS_IMPERSONATE), async (c) => {
    const p = await parseBody(c, platformReasonSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await revokeAllImpersonations(c.get("pdb"), c.req.param("id"), p.data.reason, actor(c)));
    } catch (e) {
      return serviceError(c, e);
    }
  });
