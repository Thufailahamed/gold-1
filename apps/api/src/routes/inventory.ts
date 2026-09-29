import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { inventoryInsights, listMovements, recordMovement, stockSummary } from "../services/inventory";
import { pagination, serviceError } from "./http";

const moveSchema = z.object({
  productId: z.string().min(1),
  toStatus: z.string().min(1),
  toBranchId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

const stockQuery = z.object({
  groupBy: z.enum(["branch", "purity", "product"]).optional().default("branch"),
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
      const data = await recordMovement(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/movements", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const data = await listMovements(c.env.DB, {
      ...pagination(c),
      productId: c.req.query("productId"),
      branchId: c.req.query("branchId"),
      type: c.req.query("type"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/insights", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    return c.json({ success: true, data: await inventoryInsights(c.env.DB) }, 200);
  })
  .get("/stock", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const parsed = stockQuery.safeParse({ groupBy: c.req.query("groupBy") ?? undefined });
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid groupBy" } },
        400
      );
    const data = await stockSummary(c.env.DB, parsed.data.groupBy);
    return c.json({ success: true, data }, 200);
  });
