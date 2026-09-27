import { Hono } from "hono";
import { z } from "zod";
import { createProductSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { buildLabelSvg } from "../services/label";
import {
  createProduct,
  findByBarcode,
  getProduct,
  listProducts,
  priceFor,
  voidProduct,
} from "../services/products";
import { pagination, serviceError } from "./http";

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export const products = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid product data" } },
        400
      );
    try {
      const row = await createProduct(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    const perms = c.get("permissions") as string[];
    const canManageAll = perms.includes(PERMISSIONS.BRANCHES_MANAGE);
    const data = await listProducts(c.env.DB, c.get("userId"), canManageAll, {
      ...pagination(c),
      status: c.req.query("status"),
      categoryId: c.req.query("categoryId"),
      branchId: c.req.query("branchId"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/barcode/:code", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    try {
      const data = await findByBarcode(c.env.DB, c.req.param("code"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    try {
      const data = await getProduct(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id/label", requirePerm(PERMISSIONS.PRODUCTS_READ), async (c) => {
    try {
      const { product } = await getProduct(c.env.DB, c.req.param("id"));
      const { livePrice } = await priceFor(
        c.env.DB,
        product.purity_id,
        product.net_weight,
        product.making_charge
      );
      const svg = buildLabelSvg(
        {
          barcode: product.barcode,
          name: product.name,
          gross_weight: product.gross_weight,
          net_weight: product.net_weight,
          karat: product.karat,
        },
        livePrice
      );
      c.header("Content-Type", "image/svg+xml");
      return c.body(svg, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id/void", requirePerm(PERMISSIONS.PRODUCTS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = voidSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await voidProduct(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
