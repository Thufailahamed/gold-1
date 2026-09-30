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
import { businessDateFor } from "../services/busdate";
import {
  createReturn,
  customerCredit,
  getSale,
  invoiceProfile,
  linkExchange,
  listApprovers,
  listReturns,
  listSales,
  lookupSale,
  posCatalog,
  receiveSale,
  saleBankAccounts,
  salesBreakdown,
  salesSummary,
} from "../services/sales";
import { getTaxConfig } from "../services/taxes";
import { buildCodeSvg, buildQrSvg } from "../services/label";
import { pagination, serviceError } from "./http";

/**
 * Report windows must agree with journal_entries.entry_date, which is
 * shop-local. Computing a day boundary with setHours(0,0,0,0) uses the
 * Worker's UTC clock, which is wrong for a shop east of Greenwich: between
 * 19:00 and 24:00 Colombo time the UTC day is already tomorrow.
 */
async function dayBounds(db: D1Database, period: string): Promise<{ from: number; to: number }> {
  const now = Date.now();
  const today = await businessDateFor(db, now);
  const fromDate =
    period === "today" ? today : period === "month" ? `${today.slice(0, 7)}-01` : "1970-01-01";
  return { from: Date.parse(`${fromDate}T00:00:00Z`), to: now };
}

const linkSchema = z.object({ saleId: z.string().min(1) });

export const sales = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  // The POS needs the rate to show the customer the right total before the
  // sale posts. Read-only, and cashiers do not hold accounts:view.
  .get("/tax-config", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    return c.json({ success: true, data: await getTaxConfig(c.env.DB) }, 200);
  })
  .post("/invoices", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSaleSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid sale data" } },
        400
      );
    try {
      const data = await receiveSale(c.env.DB, parsed.data, c.get("userId"), {
        enforceShelfPrice: true,
        enforceCreditLimit: true,
      });
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Type-to-find at the till: name, tag, SKU, category or karat.
  .get("/catalog", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const branchId = c.req.query("branchId");
    if (!branchId)
      return c.json({ success: false, error: { code: "VALIDATION", message: "branchId required" } }, 400);
    const data = await posCatalog(c.env.DB, {
      q: c.req.query("q") ?? "",
      branchId,
      customerId: c.req.query("customerId"),
      limit: Number(c.req.query("limit") ?? 12) || 12,
    });
    return c.json({ success: true, data }, 200);
  })
  // Which bank a "bank" payment went into, so it posts to that account.
  .get("/bank-accounts", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    return c.json({ success: true, data: await saleBankAccounts(c.env.DB, c.req.query("branchId")) }, 200);
  })
  // Balance, limit and open bills before a sale goes on credit.
  .get("/customers/:id/credit", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    try {
      const data = await customerCredit(c.env.DB, c.req.param("id"), c.req.query("branchId") ?? "");
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Letterhead and terms for the printed invoice. Cashiers print bills but
  // do not hold settings:view, so this is read under sales:view.
  .get("/invoice-profile", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    return c.json({ success: true, data: await invoiceProfile(c.env.DB) }, 200);
  })
  // Counter sign-off list for over-limit discounts and returns.
  .get("/approvers", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    return c.json({ success: true, data: await listApprovers(c.env.DB, c.get("userId")) }, 200);
  })
  // Scan an invoice barcode or a sold piece's tag to find its sale.
  .get("/lookup/:code", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await lookupSale(c.env.DB, c.req.param("code")) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/invoices/:id/barcode", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    const inv = await c.env.DB.prepare("SELECT number FROM sales_invoices WHERE id = ?")
      .bind(c.req.param("id"))
      .first<{ number: string }>();
    if (!inv)
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sale not found" } }, 404);
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(buildCodeSvg(inv.number), 200);
  })
  .get("/invoices/:id/qr", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    const inv = await c.env.DB.prepare("SELECT number FROM sales_invoices WHERE id = ?")
      .bind(c.req.param("id"))
      .first<{ number: string }>();
    if (!inv)
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sale not found" } }, 404);
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(buildQrSvg(inv.number), 200);
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
    const { from, to } = await dayBounds(c.env.DB, c.req.query("period") ?? "all");
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
    const { from, to } = await dayBounds(c.env.DB, c.req.query("period") ?? "all");
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
