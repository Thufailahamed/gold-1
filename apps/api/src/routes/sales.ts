import { Hono } from "hono";
import { z } from "zod";
import {
  createReturnSchema,
  createSaleSchema,
  exchangeSaleSchema,
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
import { exchangeSale as exchangeSaleService } from "../services/exchange";
import { getTaxConfig } from "../services/taxes";
import { buildCodeSvg, buildQrSvg } from "../services/label";
import { pagination, serviceError } from "./http";
import { assertBranchAccess, branchScope, inScope } from "../services/branchAccess";
import type { Context } from "hono";
import { getShopDb } from "../platform/resolve";

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

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;

const access = (c: Ctx, branchId: string, what = "this branch") =>
  assertBranchAccess(getShopDb(c), c.get("userId"), c.get("permissions") as string[], branchId, what);

/** Detail routes act only on bills from a branch the caller works in. */
async function assertInvoiceAccess(c: Ctx, invoiceId: string): Promise<void> {
  const row = await getShopDb(c)
    .prepare("SELECT branch_id FROM sales_invoices WHERE id = ?")
    .bind(invoiceId)
    .first<{ branch_id: string }>();
  if (!row) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
  await access(c, row.branch_id, "this bill's branch");
}

/** Scope for report/list reads; a requested branch outside it is refused. */
async function readScope(c: Ctx, branchId: string | undefined): Promise<string[] | null> {
  const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions") as string[]);
  if (branchId && !inScope(scope, branchId))
    throw Object.assign(new Error("You are not a member of this branch"), { code: "FORBIDDEN" });
  return scope;
}

const linkSchema = z.object({ saleId: z.string().min(1) });

export const sales = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  // The POS needs the rate to show the customer the right total before the
  // sale posts. Read-only, and cashiers do not hold accounts:view.
  .get("/tax-config", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    return c.json({ success: true, data: await getTaxConfig(getShopDb(c)) }, 200);
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
      await access(c, parsed.data.branchId);
      const data = await receiveSale(getShopDb(c), parsed.data, c.get("userId"), {
        enforceShelfPrice: true,
        enforceCreditLimit: true,
      });
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Old-for-new exchange: valued old gold bought back and settled against a
  // new sale in one batch. It posts a purchase AND a sale, so both the till
  // permission and the old-gold desk permission are required.
  .post(
    "/exchanges",
    requirePerm(PERMISSIONS.SALES_CREATE),
    requirePerm(PERMISSIONS.OLDGOLD_EDIT),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = exchangeSaleSchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { success: false, error: { code: "VALIDATION", message: "Invalid exchange data" } },
          400
        );
      // Taking old gold in records a new piece, which needs the create permission too.
      const perms = (c.get("permissions") ?? []) as string[];
      if (parsed.data.newOldGold.length > 0 && !perms.includes(PERMISSIONS.OLDGOLD_CREATE))
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "Taking in old gold needs the old-gold create permission" } },
          403
        );
      try {
        await access(c, parsed.data.branchId);
        const data = await exchangeSaleService(getShopDb(c), parsed.data, c.get("userId"));
        return c.json({ success: true, data }, 201);
      } catch (err) {
        return serviceError(c, err);
      }
    }
  )
  // Type-to-find at the till: name, tag, SKU, category or karat.
  .get("/catalog", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const branchId = c.req.query("branchId");
    if (!branchId)
      return c.json({ success: false, error: { code: "VALIDATION", message: "branchId required" } }, 400);
    try {
      await access(c, branchId);
    } catch (err) {
      return serviceError(c, err);
    }
    const data = await posCatalog(getShopDb(c), {
      q: c.req.query("q") ?? "",
      branchId,
      customerId: c.req.query("customerId"),
      limit: Number(c.req.query("limit") ?? 12) || 12,
    });
    // Book cost reveals margin: hidden from counter staff (who hold neither
    // purchases:view nor accounts:view). The till sells at shelf price.
    const perms = (c.get("permissions") ?? []) as string[];
    if (!perms.includes(PERMISSIONS.ACCOUNTS_VIEW) && !perms.includes(PERMISSIONS.PURCHASES_VIEW) && Array.isArray(data)) {
      return c.json(
        {
          success: true,
          data: data.map((r: Record<string, unknown>) => {
            const { cost_cents, ...rest } = r;
            return rest;
          }),
        },
        200
      );
    }
    return c.json({ success: true, data }, 200);
  })
  // Which bank a "bank" payment went into, so it posts to that account.
  .get("/bank-accounts", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    return c.json({ success: true, data: await saleBankAccounts(getShopDb(c), c.req.query("branchId")) }, 200);
  })
  // Balance, limit and open bills before a sale goes on credit.
  .get("/customers/:id/credit", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    try {
      const data = await customerCredit(getShopDb(c), c.req.param("id"), c.req.query("branchId") ?? "");
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  // Letterhead and terms for the printed invoice. Cashiers print bills but
  // do not hold settings:view, so this is read under sales:view.
  .get("/invoice-profile", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    return c.json({ success: true, data: await invoiceProfile(getShopDb(c)) }, 200);
  })
  // Scan an invoice barcode or a sold piece's tag to find its sale.
  .get("/lookup/:code", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await lookupSale(getShopDb(c), c.req.param("code")) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/invoices/:id/barcode", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      await assertInvoiceAccess(c, c.req.param("id"));
    } catch (err) {
      return serviceError(c, err);
    }
    const inv = await getShopDb(c).prepare("SELECT number FROM sales_invoices WHERE id = ?")
      .bind(c.req.param("id"))
      .first<{ number: string }>();
    if (!inv)
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sale not found" } }, 404);
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(buildCodeSvg(inv.number), 200);
  })
  .get("/invoices/:id/qr", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      await assertInvoiceAccess(c, c.req.param("id"));
    } catch (err) {
      return serviceError(c, err);
    }
    const inv = await getShopDb(c).prepare("SELECT number FROM sales_invoices WHERE id = ?")
      .bind(c.req.param("id"))
      .first<{ number: string }>();
    if (!inv)
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Sale not found" } }, 404);
    c.header("Content-Type", "image/svg+xml");
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(buildQrSvg(inv.number), 200);
  })
  .get("/invoices", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      await readScope(c, c.req.query("branchId"));
    } catch (err) {
      return serviceError(c, err);
    }
    const perms = c.get("permissions") as string[];
    const num = (k: string) => {
      const v = c.req.query(k);
      return v === undefined ? undefined : Number(v);
    };
    const data = await listSales(
      getShopDb(c),
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
    try {
      const branchId = c.req.query("branchId");
      const scope = await readScope(c, branchId);
      const { from, to } = await dayBounds(getShopDb(c), c.req.query("period") ?? "all");
      const data = await salesSummary(getShopDb(c), { from, to, branchId, branchIds: scope });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
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
    try {
      const branchId = c.req.query("branchId");
      const scope = await readScope(c, branchId);
      const { from, to } = await dayBounds(getShopDb(c), c.req.query("period") ?? "all");
      const data = await salesBreakdown(getShopDb(c), { from, to, branchId, branchIds: scope, groupBy: parsed.data.groupBy });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/invoices/:id", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      await assertInvoiceAccess(c, c.req.param("id"));
      const data = await getSale(getShopDb(c), c.req.param("id"));
      // Book cost and COGS lines reveal margin: only stock managers and
      // accounts viewers see them — never counter staff.
      const perms = (c.get("permissions") ?? []) as string[];
      if (!perms.includes(PERMISSIONS.ACCOUNTS_VIEW) && !perms.includes(PERMISSIONS.PURCHASES_VIEW)) {
        const items = (data.items ?? []).map((it: Record<string, unknown>) => {
          const { cost_cents, ...rest } = it;
          return rest;
        });
        return c.json({ success: true, data: { ...data, items, journal: [] } }, 200);
      }
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
      await assertInvoiceAccess(c, parsed.data.invoiceId);
      const data = await createReturn(getShopDb(c), parsed.data, c.get("userId"));
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
      const ret = await getShopDb(c)
        .prepare("SELECT i.branch_id FROM sales_returns r JOIN sales_invoices i ON i.id = r.invoice_id WHERE r.id = ?")
        .bind(c.req.param("id"))
        .first<{ branch_id: string }>();
      if (ret) await access(c, ret.branch_id, "this return's branch");
      await linkExchange(getShopDb(c), c.req.param("id"), parsed.data.saleId, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/returns", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      const branchId = c.req.query("branchId");
      const scope = await readScope(c, branchId);
      const data = await listReturns(getShopDb(c), {
        ...pagination(c),
        invoiceId: c.req.query("invoiceId"),
        branchId,
        branchIds: scope,
      });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
