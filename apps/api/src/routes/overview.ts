import { Hono } from "hono";
import { monthlyQuerySchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { allBranches, branchOverview } from "../services/overview";
import { toCsv } from "../services/discrepancies";
import { serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

export const overview = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.BRANCHES_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year"), branchId: c.req.query("branchId") ?? undefined });
    if (!parsed.success || !parsed.data.branchId) return c.json({ success: false, error: { code: "VALIDATION", message: "branchId, month 1-12 and year required" } }, 400);
    const csv = c.req.query("format") === "csv";
    if (csv && !(c.get("permissions") as string[]).includes(PERMISSIONS.AUDIT_EXPORT))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "CSV requires audit:export" } }, 403);
    try {
      const data = await branchOverview(getShopDb(c), parsed.data.branchId, { year: parsed.data.year, month: parsed.data.month, userId: c.get("userId"), permissions: c.get("permissions") as string[] });
      // Margin and supplier spend stay with stock managers and the owner:
      // callers holding neither purchases:view nor accounts:view (counter
      // staff) get no costCents and no purchases figure.
      const perms = c.get("permissions") as string[];
      const seesCosts = perms.includes(PERMISSIONS.ACCOUNTS_VIEW) || perms.includes(PERMISSIONS.PURCHASES_VIEW);
      const out = seesCosts
        ? data
        : (() => {
            const { costCents, ...jewellery } = data.jewellery;
            const { purchases, ...rest } = data;
            return { ...rest, jewellery, purchases: { valueCents: 0 } };
          })();
      if (csv) {
        const flat = { branch: data.branch.name, asOf: new Date(data.asOf).toISOString(), pieces: data.jewellery.pieces, netMg: data.jewellery.netMg, fineMg: data.jewellery.fineMg, costCents: data.jewellery.costCents, goldMg: data.gold.fineMg, drawer: data.cash.drawer, cardClearing: data.cash.cardClearing, salesNet: data.sales.netCents, invoices: data.sales.invoiceCount, purchases: data.purchases.valueCents };
        return new Response(toCsv([`generated_at: ${new Date().toISOString()}`, `branch: ${data.branch.name}`, "source: live-read"], Object.keys(flat), [flat as unknown as Record<string, unknown>]), { status: 200, headers: { "Content-Type": "text/csv" } });
      }
      return c.json({ success: true, data: out }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/all", requirePerm(PERMISSIONS.BRANCHES_MANAGE), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year") });
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    try {
      const data = await allBranches(getShopDb(c), { year: parsed.data.year, month: parsed.data.month, userId: c.get("userId"), permissions: c.get("permissions") as string[] });
      // Defense in depth: strip the same fields here so the invariant holds
      // even if the gate above ever widens beyond stock managers.
      const perms = c.get("permissions") as string[];
      const seesCosts = perms.includes(PERMISSIONS.ACCOUNTS_VIEW) || perms.includes(PERMISSIONS.PURCHASES_VIEW);
      if (!seesCosts) {
        return c.json(
          {
            success: true,
            data: {
              ...data,
              branches: data.branches.map((b) => {
                const { costCents, ...jewellery } = b.jewellery;
                const { purchases, ...rest } = b;
                return { ...rest, jewellery, purchases: { valueCents: 0 } };
              }),
            },
          },
          200
        );
      }
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  });
