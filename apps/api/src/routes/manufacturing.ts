import { Hono } from "hono";
import { z } from "zod";
import {
  addMfgMaterialsSchema,
  createMfgOrderSchema,
  produceMfgSchema,
  qcMfgSchema,
  PERMISSIONS,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  addMaterials,
  createOrder,
  finishOrder,
  getOrder,
  listOrders,
  mfgSummary,
  produce,
  qcCheck,
  voidOrder,
  wipList,
} from "../services/manufacturing";
import { pagination, serviceError } from "./http";

function dayBounds(period: string): { from: number; to: number } {
  const now = Date.now();
  if (period === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now };
  }
  if (period === "month") {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now };
  }
  return { from: 0, to: now };
}

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export const manufacturing = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/orders", requirePerm(PERMISSIONS.MFG_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createMfgOrderSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid order data" } },
        400
      );
    try {
      const data = await createOrder(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/orders", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    const perms = c.get("permissions") as string[];
    const data = await listOrders(
      c.env.DB,
      c.get("userId"),
      perms.includes(PERMISSIONS.BRANCHES_MANAGE),
      {
        ...pagination(c),
        status: c.req.query("status"),
        type: c.req.query("type"),
        branchId: c.req.query("branchId"),
        customerId: c.req.query("customerId"),
      }
    );
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/summary", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    const { from, to } = dayBounds(c.req.query("period") ?? "all");
    const data = await mfgSummary(c.env.DB, { from, to, branchId: c.req.query("branchId") });
    return c.json({ success: true, data }, 200);
  })
  .get("/reports/wip", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    const data = await wipList(c.env.DB, c.req.query("branchId"));
    return c.json({ success: true, data }, 200);
  })
  .get("/orders/:id", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    try {
      const data = await getOrder(c.env.DB, c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/orders/:id/materials", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = addMfgMaterialsSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid materials data" } },
        400
      );
    try {
      const data = await addMaterials(c.env.DB, c.req.param("id"), parsed.data.lots, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/orders/:id/produce", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = produceMfgSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid produce data" } },
        400
      );
    try {
      const data = await produce(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/orders/:id/qc", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = qcMfgSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid QC data" } },
        400
      );
    try {
      await qcCheck(c.env.DB, c.req.param("id"), parsed.data.pass, parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/orders/:id/finish", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    try {
      const data = await finishOrder(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/orders/:id/void", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = voidSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await voidOrder(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
