import { Hono } from "hono";
import { z } from "zod";
import { adjustGoldSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { goldLineage, goldStock, listLedger, recordAdjustment } from "../services/gold";
import { gToMg } from "@goldos/shared";
import { pagination, serviceError } from "./http";

export const gold = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/ledger", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    const num = (k: string) => {
      const v = c.req.query(k);
      return v === undefined ? undefined : Number(v);
    };
    const data = await listLedger(c.env.DB, {
      ...pagination(c),
      type: c.req.query("type"),
      branchId: c.req.query("branchId"),
      refEntity: c.req.query("refEntity"),
      refId: c.req.query("refId"),
      productId: c.req.query("productId"),
      oldGoldId: c.req.query("oldGoldId"),
      from: num("from"),
      to: num("to"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/lineage", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    const refEntity = c.req.query("refEntity");
    const refId = c.req.query("refId");
    if (!refEntity || !refId)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "refEntity and refId required" } },
        400
      );
    const data = await goldLineage(c.env.DB, refEntity, refId);
    return c.json({ success: true, data }, 200);
  })
  .get("/stock", requirePerm(PERMISSIONS.GOLD_VIEW), async (c) => {
    const parsed = z
      .object({ groupBy: z.enum(["purity", "branch", "stage"]) })
      .safeParse({ groupBy: c.req.query("groupBy") ?? undefined });
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid groupBy" } },
        400
      );
    const data = await goldStock(c.env.DB, parsed.data.groupBy);
    return c.json({ success: true, data }, 200);
  })
  .post("/ledger/adjustments", requirePerm(PERMISSIONS.GOLD_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adjustGoldSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid adjustment data" } },
        400
      );
    try {
      const data = await recordAdjustment(
        c.env.DB,
        {
          type: parsed.data.type,
          branchId: parsed.data.branchId,
          weightMg: gToMg(parsed.data.weightG),
          permille: parsed.data.permille,
          reason: parsed.data.reason,
          approvedBy: parsed.data.approvedBy,
        },
        c.get("userId")
      );
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
