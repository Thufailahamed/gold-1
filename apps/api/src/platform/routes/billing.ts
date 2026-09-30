import { Hono } from "hono";
import {
  couponSchema,
  manualInvoiceSchema,
  PLATFORM_PERMISSIONS as P,
  platformReasonSchema,
  recordPaymentSchema,
} from "@goldos/shared";
import { serviceError } from "../../routes/http";
import { requirePlatformAuth, requirePlatformPerm } from "../auth";
import type { PlatformEnv } from "../core";
import { actor, ok, page, parseBody } from "../http";
import {
  createCoupon,
  createManualInvoice,
  getInvoice,
  listCoupons,
  listInvoices,
  listPayments,
  markUncollectible,
  recordPayment,
  runBillingCycle,
  setCouponActive,
  voidInvoice,
} from "../services/billing";
import { runJob } from "../services/ops";

export const platformBilling = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/invoices", requirePlatformPerm(P.BILLING_VIEW), async (c) =>
    ok(
      c,
      await listInvoices(c.get("pdb"), {
        ...page(c),
        status: c.req.query("status") || undefined,
        overdue: c.req.query("overdue") === "1",
        tenantId: c.req.query("tenantId") || undefined,
      })
    )
  )
  .post("/invoices", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, manualInvoiceSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await createManualInvoice(c.get("pdb"), p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .get("/invoices/:id", requirePlatformPerm(P.BILLING_VIEW), async (c) => {
    try {
      return ok(c, await getInvoice(c.get("pdb"), c.req.param("id")));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/invoices/:id/payments", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, recordPaymentSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await recordPayment(c.get("pdb"), c.req.param("id"), p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/invoices/:id/void", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, platformReasonSchema);
    if (!p.ok) return p.res;
    try {
      await voidInvoice(c.get("pdb"), c.req.param("id"), p.data.reason, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/invoices/:id/uncollectible", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, platformReasonSchema);
    if (!p.ok) return p.res;
    try {
      await markUncollectible(c.get("pdb"), c.req.param("id"), p.data.reason, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .get("/payments", requirePlatformPerm(P.BILLING_VIEW), async (c) =>
    ok(c, await listPayments(c.get("pdb"), { ...page(c), tenantId: c.req.query("tenantId") || undefined }))
  )
  .post("/run-cycle", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    try {
      const pdb = c.get("pdb");
      return ok(c, await runJob(pdb, "billing_cycle", "manual", c.get("adminId"), () => runBillingCycle(pdb, c.get("adminId"))));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .get("/coupons", requirePlatformPerm(P.BILLING_VIEW), async (c) => ok(c, await listCoupons(c.get("pdb"))))
  .post("/coupons", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, couponSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await createCoupon(c.get("pdb"), p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/coupons/:id/:state{retire|activate}", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    try {
      await setCouponActive(c.get("pdb"), c.req.param("id"), c.req.param("state") === "activate", actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  });
