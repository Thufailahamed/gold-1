import { Hono } from "hono";
import { monthlyQuerySchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { allBranches, branchOverview } from "../services/overview";
import { toCsv } from "../services/discrepancies";
import { serviceError } from "./http";

export const overview = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.BRANCHES_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year"), branchId: c.req.query("branchId") ?? undefined });
    if (!parsed.success || !parsed.data.branchId) return c.json({ success: false, error: { code: "VALIDATION", message: "branchId, month 1-12 and year required" } }, 400);
    try {
      const data = await branchOverview(c.env.DB, parsed.data.branchId, { year: parsed.data.year, month: parsed.data.month, userId: c.get("userId"), permissions: c.get("permissions") as string[] });
      if (c.req.query("format") === "csv") {
        if (!(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT))
          return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
        const flat = { branch: data.branch.name, asOf: new Date(data.asOf).toISOString(), pieces: data.jewellery.pieces, netMg: data.jewellery.netMg, fineMg: data.jewellery.fineMg, costCents: data.jewellery.costCents, goldMg: data.gold.fineMg, drawer: data.cash.drawer, cardClearing: data.cash.cardClearing, salesNet: data.sales.netCents, invoices: data.sales.invoiceCount, purchases: data.purchases.valueCents };
        return new Response(toCsv([`generated_at: ${new Date().toISOString()}`, `branch: ${data.branch.name}`, "source: live-read"], Object.keys(flat), [flat as unknown as Record<string, unknown>]), { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/all", requirePerm(PERMISSIONS.BRANCHES_MANAGE), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year") });
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    try {
      const data = await allBranches(c.env.DB, { year: parsed.data.year, month: parsed.data.month, userId: c.get("userId"), permissions: c.get("permissions") as string[] });
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  });
