import { Hono } from "hono";
import { z } from "zod";
import {
  createInvoiceSchema,
  createOrderSchema,
  lkrToCents,
  payInvoiceSchema,
  PERMISSIONS,
  voidInvoiceSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  cancelOrder,
  createInvoiceDirect,
  createOrder,
  getInvoice,
  getOrder,
  listInvoices,
  listOrders,
  payInvoice,
  purchaseBreakdown,
  purchaseSummary,
  receiveOrder,
  voidInvoice,
} from "../services/purchases";
import { pagination, serviceError } from "./http";

const receiveSchema = z.object({
  chargesLkr: z.number().min(0).optional(),
  paidLkr: z.number().min(0).optional(),
  paidMethod: z.enum(["cash", "bank"]).optional(),
});

const reasonSchema = z.object({ reason: z.string().min(1).max(500) });

function dayBounds(period: string): { from: number; to: number } {
  const now = Date.now();
  if (period === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now };
  }
  if (period === "month") {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now };
  }
  return { from: 0, to: now };
}

export const purchases = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/orders", requirePerm(PERMISSIONS.PURCHASES_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid order data" } },
        400
      );
    try {
      const data = await createOrder(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/orders", requirePerm(PERMISSIONS.PURCHASES_VIEW), async (c) => {
    const perms = c.get("permissions") as string[];
    const data = await listOrders(
      c.env.DB,
      c.get("userId"),
      perms.includes(PERMISSIONS.BRANCHES_MANAGE),
      {
        ...pagination(c),
        supplierId: c.req.query("supplierId"),
        branchId: c.req.query("branchId"),
        status: c.req.query("status"),
      }
    );
    return c.json({ success: true, data }, 200);
  })
  .get("/orders/:id", requirePerm(PERMISSIONS.PURCHASES_VIEW), async (c) => {
    try {
      const data = await getOrder(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/orders/:id/cancel", requirePerm(PERMISSIONS.PURCHASES_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reasonSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await cancelOrder(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/orders/:id/receive", requirePerm(PERMISSIONS.PURCHASES_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = receiveSchema.safeParse(body ?? {});
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid receive data" } },
        400
      );
    try {
      const data = await receiveOrder(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/invoices", requirePerm(PERMISSIONS.PURCHASES_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createInvoiceSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid invoice data" } },
        400
      );
    try {
      const data = await createInvoiceDirect(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/invoices", requirePerm(PERMISSIONS.PURCHASES_VIEW), async (c) => {
    const perms = c.get("permissions") as string[];
    const num = (k: string) => {
      const v = c.req.query(k);
      return v === undefined ? undefined : Number(v);
    };
    const data = await listInvoices(
      c.env.DB,
      c.get("userId"),
      perms.includes(PERMISSIONS.BRANCHES_MANAGE),
      {
        ...pagination(c),
        supplierId: c.req.query("supplierId"),
        branchId: c.req.query("branchId"),
        status: c.req.query("status"),
        from: num("from"),
        to: num("to"),
      }
    );
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/summary", requirePerm(PERMISSIONS.PURCHASES_VIEW), async (c) => {
    const { from, to } = dayBounds(c.req.query("period") ?? "all");
    const data = await purchaseSummary(c.env.DB, {
      from,
      to,
      supplierId: c.req.query("supplierId"),
      branchId: c.req.query("branchId"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/breakdown", requirePerm(PERMISSIONS.PURCHASES_VIEW), async (c) => {
    const parsed = z
      .object({ groupBy: z.enum(["supplier", "purity", "category"]) })
      .safeParse({ groupBy: c.req.query("groupBy") });
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid groupBy" } },
        400
      );
    const { from, to } = dayBounds(c.req.query("period") ?? "all");
    const data = await purchaseBreakdown(c.env.DB, {
      from,
      to,
      branchId: c.req.query("branchId"),
      groupBy: parsed.data.groupBy,
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/invoices/:id", requirePerm(PERMISSIONS.PURCHASES_VIEW), async (c) => {
    try {
      const data = await getInvoice(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/invoices/:id/payments", requirePerm(PERMISSIONS.PURCHASES_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = payInvoiceSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid payment data" } },
        400
      );
    try {
      const data = await payInvoice(
        c.env.DB,
        c.req.param("id"),
        lkrToCents(parsed.data.amountLkr),
        parsed.data.method,
        c.get("userId")
      );
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/invoices/:id/void", requirePerm(PERMISSIONS.PURCHASES_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = voidInvoiceSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await voidInvoice(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
