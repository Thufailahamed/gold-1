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
import { releaseReservation, reserveProduct } from "../services/inventory";
import { branchScope, inScope } from "../services/branchAccess";
import { pagination, serviceError } from "./http";

const voidSchema = z.object({ reason: z.string().min(1).max(500) });
const reserveSchema = z.object({
  customerId: z.string().min(1),
  note: z.string().trim().min(1).max(500),
  untilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const releaseSchema = z.object({ reason: z.string().max(500).optional() });

type Ctx = { env: Env; get: (k: "userId" | "permissions") => unknown };

/** Branch staff act only on pieces at their own branches (as /inventory/movements). */
async function outOfScope(c: Ctx, productId: string): Promise<boolean> {
  const prod = await c.env.DB.prepare("SELECT branch_id FROM products WHERE id = ?")
    .bind(productId)
    .first<{ branch_id: string }>();
  if (!prod) return false;
  const scope = await branchScope(c.env.DB, c.get("userId") as string, c.get("permissions") as string[]);
  return !inScope(scope, prod.branch_id);
}

const forbiddenBranch = {
  success: false as const,
  error: { code: "FORBIDDEN", message: "You are not a member of that branch" },
};

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
      // The tag must show what the till charges: POS and createSale price a
      // piece at its selling-price override when one is set, live rate otherwise.
      const tagPrice =
        product.selling_price_cents !== null
          ? {
              amount: centsToLkr(product.selling_price_cents),
              ratePerGram: livePrice ? centsToLkr(livePrice.rate_cents_per_g) : 0,
              rateEffectiveFrom: livePrice?.rate_effective_from ?? 0,
            }
          : livePrice
            ? {
                amount: centsToLkr(livePrice.amount_cents),
                ratePerGram: centsToLkr(livePrice.rate_cents_per_g),
                rateEffectiveFrom: livePrice.rate_effective_from,
              }
            : null;
      const svg = buildLabelSvg(
        {
          barcode: product.barcode,
          name: product.name,
          gross_weight: mgToG(product.gross_mg),
          net_weight: mgToG(product.net_mg),
          karat: product.karat,
        },
        tagPrice,
        // Tags carry a QR beside the bars by default, so a phone camera or a
        // 2D scanner can bill the piece; ?qr=0 prints the bars-only tag.
        { qr: c.req.query("qr") !== "0" }
      );
      c.header("Content-Type", "image/svg+xml");
      // Price moves with the rate; never serve a stale tag from cache.
      c.header("Cache-Control", "no-store");
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
  .delete("/:id/images/:img", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const id = c.req.param("id");
    const key = `products/${id}/${c.req.param("img")}`;
    const prev = await c.env.DB.prepare("SELECT image_keys, branch_id FROM products WHERE id = ?")
      .bind(id)
      .first<{ image_keys: string; branch_id: string }>();
    if (!prev)
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Product not found" } },
        404
      );
    const keys = JSON.parse(prev.image_keys) as string[];
    if (!keys.includes(key))
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Image not found" } },
        404
      );
    const next = keys.filter((k) => k !== key);
    // Row first: an orphaned object in R2 is harmless, a row pointing at a
    // deleted object is a broken image on every screen.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE products SET image_keys = ? WHERE id = ?").bind(JSON.stringify(next), id),
      buildAuditStmt(c.env.DB, {
        userId: c.get("userId"),
        action: "product.image_remove",
        entity: "product",
        entityId: id,
        prev: { key },
        branchId: prev.branch_id,
      }),
    ]);
    await c.env.R2.delete(key);
    return c.json({ success: true, data: { image_keys: next } }, 200);
  })
  .post("/:id/reserve", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = reserveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Customer and note are required" } },
        400
      );
    try {
      if (await outOfScope(c, c.req.param("id"))) return c.json(forbiddenBranch, 403);
      const data = await reserveProduct(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/:id/release", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = releaseSchema.safeParse((await c.req.json().catch(() => null)) ?? {});
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid release" } },
        400
      );
    try {
      if (await outOfScope(c, c.req.param("id"))) return c.json(forbiddenBranch, 403);
      await releaseReservation(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
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
