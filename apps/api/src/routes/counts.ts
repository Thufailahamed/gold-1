import { Hono } from "hono";
import { approveCountSchema, PERMISSIONS, scanSchema, startCountSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { approveCount, cancelCount, compare, recordScan, startCount, addNote } from "../services/counts";
import { serviceError } from "./http";

export const counts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") ?? undefined;
    const perms = c.get("permissions") as string[];
    if (!branchId && !perms.includes(PERMISSIONS.BRANCHES_MANAGE))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
    const { results } = await c.env.DB.prepare(
      `SELECT id, branch_id, scope, scope_ref, status, opened_by, created_at FROM stock_counts ${branchId ? "WHERE branch_id = ?" : ""} ORDER BY created_at DESC LIMIT 50`
    ).bind(...(branchId ? [branchId] : [])).all();
    return c.json({ success: true, data: results ?? [] }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = startCountSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid count" } }, 400);
    try {
      const data = await startCount(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/scans", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = scanSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "barcode required" } }, 400);
    try {
      const data = await recordScan(c.env.DB, c.req.param("id"), parsed.data.barcode, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/compare", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await compare(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/notes", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.productId || !body?.note) return c.json({ success: false, error: { code: "VALIDATION", message: "productId and note required" } }, 400);
    await addNote(c.env.DB, c.req.param("id"), body.productId, String(body.note).slice(0, 500), c.get("userId"));
    return c.json({ success: true, data: { ok: true } }, 200);
  })
  .post("/:id/approve", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
    const parsed = approveCountSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason and approvedBy required" } }, 400);
    try {
      const data = await approveCount(c.env.DB, c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.reason) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    await cancelCount(c.env.DB, c.req.param("id"), String(body.reason).slice(0, 500), c.get("userId"));
    return c.json({ success: true, data: { ok: true } }, 200);
  });
