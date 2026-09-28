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
import { businessDateFor } from "../services/busdate";
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

/**
 * Report windows must agree with journal_entries.entry_date, which is
 * shop-local. Computing a day boundary with setHours(0,0,0,0) uses the
 * Worker's UTC clock, which is wrong for a shop east of Greenwich: between
 * 19:00 and 24:00 Colombo time the UTC day is already tomorrow.
 */
async function dayBounds(db: D1Database, period: string): Promise<{ from: number; to: number }> {
  const now = Date.now();
  const today = await businessDateFor(db, now);
  const fromDate =
    period === "today" ? today : period === "month" ? `${today.slice(0, 7)}-01` : "1970-01-01";
  return { from: Date.parse(`${fromDate}T00:00:00Z`), to: now };
}

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

/** paidFrom is optional: omit it to accrue the labour to 2200 Other Payables. */
const finishSchema = z.object({ paidFrom: z.enum(["cash", "bank"]).optional() });

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
    const { from, to } = await dayBounds(c.env.DB, c.req.query("period") ?? "all");
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
    // An empty body is the common case and simply means "accrue", so a
    // malformed body is not an error here.
    const body = await c.req.json().catch(() => null);
    const parsed = finishSchema.safeParse(body);
    try {
      const data = await finishOrder(
        c.env.DB,
        c.req.param("id"),
        { paidFrom: parsed.success ? parsed.data.paidFrom : undefined },
        c.get("userId")
      );
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
