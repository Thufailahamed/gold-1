import { Hono } from "hono";
import { z } from "zod";
import {
  createReturnSchema,
  createSaleSchema,
  PERMISSIONS,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  createReturn,
  getSale,
  linkExchange,
  listReturns,
  listSales,
  receiveSale,
  salesBreakdown,
  salesSummary,
} from "../services/sales";
import { pagination, serviceError } from "./http";

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

const linkSchema = z.object({ saleId: z.string().min(1) });

export const sales = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/invoices", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSaleSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid sale data" } },
        400
      );
    try {
      const data = await receiveSale(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/invoices", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    const perms = c.get("permissions") as string[];
    const num = (k: string) => {
      const v = c.req.query(k);
      return v === undefined ? undefined : Number(v);
    };
    const data = await listSales(
      c.env.DB,
      c.get("userId"),
      perms.includes(PERMISSIONS.BRANCHES_MANAGE),
      {
        ...pagination(c),
        customerId: c.req.query("customerId"),
        branchId: c.req.query("branchId"),
        status: c.req.query("status"),
        from: num("from"),
        to: num("to"),
      }
    );
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/summary", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    const { from, to } = dayBounds(c.req.query("period") ?? "all");
    const data = await salesSummary(c.env.DB, {
      from,
      to,
      branchId: c.req.query("branchId"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/breakdown", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    const parsed = z
      .object({ groupBy: z.enum(["category", "purity", "branch", "salesperson", "payment", "product"]) })
      .safeParse({ groupBy: c.req.query("groupBy") });
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid groupBy" } },
        400
      );
    const { from, to } = dayBounds(c.req.query("period") ?? "all");
    const data = await salesBreakdown(c.env.DB, {
      from,
      to,
      branchId: c.req.query("branchId"),
      groupBy: parsed.data.groupBy,
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/invoices/:id", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      const data = await getSale(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/returns", requirePerm(PERMISSIONS.SALES_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createReturnSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid return data" } },
        400
      );
    try {
      const data = await createReturn(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/returns/:id/link", requirePerm(PERMISSIONS.SALES_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "saleId required" } },
        400
      );
    try {
      await linkExchange(c.env.DB, c.req.param("id"), parsed.data.saleId, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/returns", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      const data = await listReturns(c.env.DB, {
        ...pagination(c),
        invoiceId: c.req.query("invoiceId"),
        branchId: c.req.query("branchId"),
      });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
