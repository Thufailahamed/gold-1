import { Hono } from "hono";
import { z } from "zod";
import { collectRepairSchema, createRepairSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { assignRepair, cancelRepair, collectRepair, createRepair, finishRepair, getRepair, listRepairs, qcRepair } from "../services/repairs";
import { pagination, serviceError } from "./http";

const assignSchema = z.object({ technicianId: z.string().min(1) });
const qcSchema = z.object({ pass: z.boolean(), reason: z.string().max(500).optional() });
const cancelSchema = z.object({ reason: z.string().min(1).max(500) });

export const repairRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    const data = await listRepairs(c.env.DB, { ...pagination(c), branchId: c.req.query("branchId"), customerId: c.req.query("customerId"), status: c.req.query("status") });
    return c.json({ success: true, data }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const parsed = createRepairSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid repair" } }, 400);
    try {
      const data = await createRepair(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await getRepair(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/assign", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const parsed = assignSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "technicianId required" } }, 400);
    try {
      await assignRepair(c.env.DB, c.req.param("id"), parsed.data.technicianId, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/finish", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    try {
      await finishRepair(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/qc", requirePerm(PERMISSIONS.SALES_APPROVE), async (c) => {
    const parsed = qcSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "pass required" } }, 400);
    try {
      await qcRepair(c.env.DB, c.req.param("id"), parsed.data.pass, parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/collect", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const parsed = collectRepairSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid collection" } }, 400);
    try {
      const data = await collectRepair(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.SALES_CANCEL), async (c) => {
    const parsed = cancelSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    try {
      await cancelRepair(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  });
