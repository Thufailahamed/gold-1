import { Hono } from "hono";
import { z } from "zod";
import {
  addMeltItemsSchema,
  createMeltSchema,
  approveMeltSchema,
  meltRecordSchema,
  PERMISSIONS,
} from "@goldos/shared";
import bwipjs from "bwip-js";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  addItems,
  approveBatch,
  createBatch,
  getBatch,
  listBatches,
  lockBatch,
  recordMelt,
  voidBatch,
} from "../services/melting";
import { pagination, serviceError } from "./http";

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export const melting = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/batches", requirePerm(PERMISSIONS.GOLD_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createMeltSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid batch data" } },
        400
      );
    try {
      const data = await createBatch(c.env.DB, parsed.data.branchId, parsed.data.notes, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/batches", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    const data = await listBatches(c.env.DB, {
      ...pagination(c),
      status: c.req.query("status"),
      branchId: c.req.query("branchId"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/batches/:id", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    try {
      const data = await getBatch(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/batches/:id/label", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    try {
      const { batch } = await getBatch(c.env.DB, c.req.param("id"));
      const bars = bwipjs.toSVG({
        bcid: "code128",
        text: batch.number,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: "center",
      });
      const inner = bars.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">` +
        `<text x="200" y="28" text-anchor="middle" font-size="20" font-family="sans-serif">${batch.number}</text>` +
        `<svg x="40" y="45" width="320" height="110" viewBox="0 0 320 110">${inner}</svg>` +
        `<text x="200" y="182" text-anchor="middle" font-size="12" font-family="sans-serif">${batch.number}</text>` +
        `</svg>`;
      c.header("Content-Type", "image/svg+xml");
      return c.body(svg, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/batches/:id/items", requirePerm(PERMISSIONS.GOLD_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = addMeltItemsSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid items data" } },
        400
      );
    try {
      const data = await addItems(c.env.DB, c.req.param("id"), parsed.data.oldGoldIds, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/batches/:id/lock", requirePerm(PERMISSIONS.GOLD_MANAGE), async (c) => {
    try {
      await lockBatch(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/batches/:id/melt", requirePerm(PERMISSIONS.GOLD_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = meltRecordSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid melt data" } },
        400
      );
    try {
      const data = await recordMelt(
        c.env.DB,
        c.req.param("id"),
        {
          outputWeightG: parsed.data.outputWeightG,
          assayPermille: parsed.data.assayPermille,
          wasteG: parsed.data.wasteG,
          outputType: parsed.data.outputType,
        },
        c.get("userId")
      );
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/batches/:id/approve", requirePerm(PERMISSIONS.GOLD_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = approveMeltSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      const data = await approveBatch(
        c.env.DB,
        c.req.param("id"),
        { reason: parsed.data.reason, approvedBy: parsed.data.approvedBy },
        c.get("userId")
      );
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/batches/:id/void", requirePerm(PERMISSIONS.GOLD_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = voidSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await voidBatch(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
