import { Hono } from "hono";
import { z } from "zod";
import { createCategorySchema, createPuritySchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  createCategory,
  createPurity,
  deactivateCategory,
  deactivatePurity,
  listCategories,
  listPurities,
} from "../services/catalog";
import { pagination, serviceError } from "./http";

const deactivateSchema = z.object({ reason: z.string().min(1).max(500) });

export const catalog = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/categories", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid category data" } },
        400
      );
    try {
      const row = await createCategory(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/categories", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listCategories(c.env.DB, pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .patch("/categories/:id/deactivate", requirePerm(PERMISSIONS.MASTERS_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deactivateSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await deactivateCategory(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/purities", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createPuritySchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid purity data" } },
        400
      );
    try {
      const row = await createPurity(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/purities", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listPurities(c.env.DB, pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .patch("/purities/:id/deactivate", requirePerm(PERMISSIONS.MASTERS_CANCEL), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deactivateSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await deactivatePurity(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
