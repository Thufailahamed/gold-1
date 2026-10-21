import { Hono } from "hono";
import { z } from "zod";
import {
  createCategorySchema,
  createDesignSchema,
  createMetalTypeSchema,
  createProductTypeSchema,
  createPuritySchema,
  createStoneTypeSchema,
  createSubcategorySchema,
  PERMISSIONS,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  createCategory,
  createDesign,
  createMetalType,
  createProductType,
  createPurity,
  createStoneType,
  createSubcategory,
  deactivateCategory,
  deleteCategory,
  reactivateCategory,
  updateCategory,
  deactivatePurity,
  listCategories,
  listDesigns,
  listMetalTypes,
  listProductTypes,
  listPurities,
  listStoneTypes,
  listSubcategories,
} from "../services/catalog";
import { pagination, serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

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
      const row = await createCategory(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/categories", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listCategories(getShopDb(c), pagination(c));
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
      await deactivateCategory(getShopDb(c), c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/categories/:id", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid category data" } }, 400);
    try {
      await updateCategory(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/categories/:id/reactivate", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
    try {
      await reactivateCategory(getShopDb(c), c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .delete("/categories/:id", requirePerm(PERMISSIONS.MASTERS_CANCEL), async (c) => {
    try {
      await deleteCategory(getShopDb(c), c.req.param("id"), c.get("userId"));
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
      const row = await createPurity(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/purities", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listPurities(getShopDb(c), pagination(c));
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
      await deactivatePurity(getShopDb(c), c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/subcategories", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSubcategorySchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid subcategory data" } },
        400
      );
    try {
      const row = await createSubcategory(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/subcategories", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listSubcategories(getShopDb(c), c.req.query("categoryId"), pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .post("/designs", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createDesignSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid design data" } },
        400
      );
    try {
      const row = await createDesign(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/designs", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listDesigns(getShopDb(c), pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .post("/product-types", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createProductTypeSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid product type data" } },
        400
      );
    try {
      const row = await createProductType(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/product-types", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listProductTypes(getShopDb(c), pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .post("/metal-types", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createMetalTypeSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid metal type data" } },
        400
      );
    try {
      const row = await createMetalType(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/metal-types", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listMetalTypes(getShopDb(c), pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .post("/stone-types", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createStoneTypeSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid stone type data" } },
        400
      );
    try {
      const row = await createStoneType(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/stone-types", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const data = await listStoneTypes(getShopDb(c), pagination(c));
    return c.json({ success: true, data }, 200);
  });
