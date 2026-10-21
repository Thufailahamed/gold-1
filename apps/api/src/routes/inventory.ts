import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { categoryCounts, inventoryInsights, listMovements, recordMovement, stockSummary } from "../services/inventory";
import { branchScope, inScope } from "../services/branchAccess";
import { pagination, serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

const forbiddenBranch = { success: false as const, error: { code: "FORBIDDEN", message: "You are not a member of that branch" } };

const moveSchema = z.object({
  productId: z.string().min(1),
  toStatus: z.string().min(1),
  toBranchId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

const stockQuery = z.object({
  groupBy: z.enum(["branch", "purity", "product", "category"]).optional().default("branch"),
});

export const inventory = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/movements", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = moveSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid movement" } },
        400
      );
    try {
      const prod = await getShopDb(c).prepare("SELECT branch_id FROM products WHERE id = ?").bind(parsed.data.productId).first<{ branch_id: string }>();
      if (prod) {
        const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions") as string[]);
        if (!inScope(scope, prod.branch_id)) return c.json(forbiddenBranch, 403);
      }
      const data = await recordMovement(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/movements", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions") as string[]);
    const branchId = c.req.query("branchId") || undefined;
    if (branchId && !inScope(scope, branchId)) return c.json(forbiddenBranch, 403);
    const data = await listMovements(getShopDb(c), {
      ...pagination(c),
      productId: c.req.query("productId"),
      branchId,
      type: c.req.query("type"),
      scope,
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/insights", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions") as string[]);
    return c.json({ success: true, data: await inventoryInsights(getShopDb(c), scope) }, 200);
  })
  .get("/stock", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const parsed = stockQuery.safeParse({ groupBy: c.req.query("groupBy") ?? undefined });
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid groupBy" } },
        400
      );
    const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions") as string[]);
    const branchId = c.req.query("branchId") || undefined;
    if (branchId && !inScope(scope, branchId)) return c.json(forbiddenBranch, 403);
    const categoryId = c.req.query("categoryId") || undefined;
    const data = await stockSummary(getShopDb(c), parsed.data.groupBy, scope, branchId, categoryId);
    return c.json({ success: true, data }, 200);
  })
  .get("/stock/categories", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions") as string[]);
    const branchId = c.req.query("branchId") || undefined;
    if (branchId && !inScope(scope, branchId)) return c.json(forbiddenBranch, 403);
    const data = await categoryCounts(getShopDb(c), scope, branchId);
    return c.json({ success: true, data }, 200);
  });
