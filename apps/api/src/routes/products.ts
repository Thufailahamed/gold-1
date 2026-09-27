import { Hono } from "hono";
import { z } from "zod";
import {
  centsToLkr,
  createProductSchema,
  editProductSchema,
  mgToG,
  PERMISSIONS,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { buildAuditStmt } from "../middleware/audit";
import { buildLabelSvg } from "../services/label";
import {
  createProduct,
  editProduct,
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
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_CREATE), async (c) => {
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
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const perms = c.get("permissions") as string[];
    const canManageAll = perms.includes(PERMISSIONS.BRANCHES_MANAGE);
    const num = (k: string) => {
      const v = c.req.query(k);
      return v === undefined ? undefined : Number(v);
    };
    const data = await listProducts(c.env.DB, c.get("userId"), canManageAll, {
      ...pagination(c),
      status: c.req.query("status"),
      categoryId: c.req.query("categoryId"),
      purityId: c.req.query("purityId"),
      branchId: c.req.query("branchId"),
      minG: num("minG"),
      maxG: num("maxG"),
      minPriceLkr: num("minPriceLkr"),
      maxPriceLkr: num("maxPriceLkr"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/barcode/:code", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      const data = await findByBarcode(c.env.DB, c.req.param("code"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      const data = await getProduct(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = editProductSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid product data" } },
        400
      );
    try {
      const data = await editProduct(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/:id/label", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      const { product } = await getProduct(c.env.DB, c.req.param("id"));
      const { livePrice } = await priceFor(
        c.env.DB,
        product.purity_id,
        product.net_mg,
        product.making_cents
      );
      const svg = buildLabelSvg(
        {
          barcode: product.barcode,
          name: product.name,
          gross_weight: mgToG(product.gross_mg),
          net_weight: mgToG(product.net_mg),
          karat: product.karat,
        },
        livePrice
          ? {
              amount: centsToLkr(livePrice.amount_cents),
              ratePerGram: centsToLkr(livePrice.rate_cents_per_g),
              rateEffectiveFrom: livePrice.rate_effective_from,
            }
          : null
      );
      c.header("Content-Type", "image/svg+xml");
      return c.body(svg, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/images", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const id = c.req.param("id");
    const prev = await c.env.DB.prepare(
      "SELECT id, image_keys, branch_id FROM products WHERE id = ?"
    )
      .bind(id)
      .first<{ id: string; image_keys: string; branch_id: string }>();
    if (!prev)
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Product not found" } },
        404
      );
    const keys = JSON.parse(prev.image_keys) as string[];
    if (keys.length >= 10)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Max 10 images" } },
        400
      );
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File))
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "file required" } },
        400
      );
    if (file.size > 5 * 1024 * 1024)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Max 5MB" } },
        400
      );
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "jpeg/png/webp only" } },
        400
      );
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `products/${id}/${crypto.randomUUID()}.${ext}`;
    await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    const next = [...keys, key];
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE products SET image_keys = ? WHERE id = ?").bind(
        JSON.stringify(next),
        id
      ),
      buildAuditStmt(c.env.DB, {
        userId: c.get("userId"),
        action: "product.image_add",
        entity: "product",
        entityId: id,
        next: { key },
        branchId: prev.branch_id,
      }),
    ]);
    return c.json({ success: true, data: { key, image_keys: next } }, 201);
  })
  .get("/:id/images/:img", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const key = `products/${c.req.param("id")}/${c.req.param("img")}`;
    const obj = await c.env.R2.get(key);
    if (!obj)
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Image not found" } },
        404
      );
    c.header("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
    return c.body(await obj.arrayBuffer(), 200);
  })
  .patch("/:id/void", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
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
