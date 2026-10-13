import { Hono } from "hono";
import {
  couponSchema,
  manualInvoiceSchema,
  PLATFORM_PERMISSIONS as P,
  platformReasonSchema,
  recordPaymentSchema,
  refundPaymentSchema,
} from "@goldos/shared";
import { serviceError } from "../../routes/http";
import { requirePlatformAuth, requirePlatformPerm } from "../auth";
import type { PlatformEnv } from "../core";
import { actor, ok, page, parseBody } from "../http";
import { buildPlatformAudit } from "../core";
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
  voidPayment,
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
  .post("/payments/:id/void", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, refundPaymentSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await voidPayment(c.get("pdb"), c.req.param("id"), p.data.reason, actor(c)));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/payments/:id/refund", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, refundPaymentSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await voidPayment(c.get("pdb"), c.req.param("id"), p.data.reason, actor(c)));
    } catch (e) {
      return serviceError(c, e);
    }
  })
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
  })
  /* ---- bank-slip receipts (manual billing evidence) */
  .get("/receipts", requirePlatformPerm(P.BILLING_VIEW), async (c) => {
    const status = c.req.query("status") || "PENDING";
    if (!["PENDING", "APPROVED", "REJECTED"].includes(status))
      return c.json({ success: false, error: { code: "VALIDATION", message: "Unknown receipt status" } }, 400);
    const { results } = await c.get("pdb").prepare(
      `SELECT r.id, r.tenant_id, t.slug AS tenant_slug, t.name AS tenant_name, r.invoice_id, i.number AS invoice_number,
              r.amount_cents, r.bank_ref, r.status, r.reject_reason, r.created_at, r.reviewed_at
       FROM tenant_receipts r JOIN tenants t ON t.id = r.tenant_id JOIN invoices i ON i.id = r.invoice_id
       WHERE r.status = ? ORDER BY r.created_at LIMIT 100`
    ).bind(status).all();
    return ok(c, { rows: results ?? [], total: (results ?? []).length });
  })
  .get("/receipts/:id/download", requirePlatformPerm(P.BILLING_VIEW), async (c) => {
    const receipt = await c.get("pdb").prepare("SELECT r2_key FROM tenant_receipts WHERE id = ?").bind(c.req.param("id"))
      .first<{ r2_key: string }>();
    if (!receipt) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    const obj = await c.env.R2.get(receipt.r2_key);
    if (!obj) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Slip file not found" } }, 404);
    return c.body(await obj.arrayBuffer(), 200, { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream" });
  })
  .post("/receipts/:id/approve", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const pdb = c.get("pdb");
    try {
      const receipt = await pdb.prepare("SELECT * FROM tenant_receipts WHERE id = ?").bind(c.req.param("id"))
        .first<{ id: string; tenant_id: string; invoice_id: string; amount_cents: number; bank_ref: string | null; status: string }>();
      if (!receipt) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      if (receipt.status !== "PENDING")
        return c.json({ success: false, error: { code: "CONFLICT", message: `This slip is already ${receipt.status.toLowerCase()}` } }, 409);
      const inv = await pdb.prepare("SELECT total_cents, amount_paid_cents FROM invoices WHERE id = ? AND tenant_id = ? AND status = 'OPEN'")
        .bind(receipt.invoice_id, receipt.tenant_id).first<{ total_cents: number; amount_paid_cents: number }>();
      if (!inv) return c.json({ success: false, error: { code: "CONFLICT", message: "The invoice is no longer open" } }, 409);
      const remaining = inv.total_cents - inv.amount_paid_cents;
      // Full-amount rule (v1): the slip must cover exactly what is still owed.
      if (receipt.amount_cents !== remaining)
        return c.json({ success: false, error: { code: "VALIDATION", message: "The invoice balance changed since upload. Ask the shop to re-upload." } }, 400);
      const paid = await recordPayment(pdb, receipt.invoice_id, { amountCents: remaining, method: "BANK", reference: receipt.bank_ref ?? `slip:${receipt.id}` }, actor(c));
      await pdb.prepare("UPDATE tenant_receipts SET status = 'APPROVED', reviewed_at = ?, reviewed_by = ? WHERE id = ?").bind(Date.now(), actor(c).id, receipt.id).run();
      return ok(c, { ok: true, invoiceStatus: paid.status });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/receipts/:id/reject", requirePlatformPerm(P.BILLING_MANAGE), async (c) => {
    const p = await parseBody(c, platformReasonSchema);
    if (!p.ok) return p.res;
    try {
      const pdb = c.get("pdb");
      const receipt = await pdb.prepare("SELECT id, tenant_id, status FROM tenant_receipts WHERE id = ?").bind(c.req.param("id"))
        .first<{ id: string; tenant_id: string; status: string }>();
      if (!receipt) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      if (receipt.status !== "PENDING")
        return c.json({ success: false, error: { code: "CONFLICT", message: `This slip is already ${receipt.status.toLowerCase()}` } }, 409);
      const now = Date.now();
      const a = actor(c);
      await pdb.batch([
        pdb.prepare("UPDATE tenant_receipts SET status = 'REJECTED', reject_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?").bind(p.data.reason, now, a.id, receipt.id),
        buildPlatformAudit(pdb, { adminId: a.id, action: "receipt.reject", entity: "tenant_receipt", entityId: receipt.id, tenantId: receipt.tenant_id, prev: { status: "PENDING" }, next: { status: "REJECTED" }, reason: p.data.reason, ip: a.ip }),
      ]);
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  });
