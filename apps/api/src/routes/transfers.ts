import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS, requestTransferSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { approveTransfer, cancelTransfer, dispatchTransfer, loadTransfer, receiveLines, recallLines, reconcileTransfer, requestTransfer } from "../services/transfers";
import { serviceError } from "./http";

const approveSchema = z.object({ approvedBy: z.string().min(1) });
const receiveSchema = z.object({ barcodes: z.array(z.string().min(1).max(32)).min(1).max(100) });
const recallSchema = z.object({ productIds: z.array(z.string().min(1)).min(1).max(100) });
const reasonSchema = z.object({ reason: z.string().min(1).max(500) });

export const stockTransferRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const from = c.req.query("fromBranchId") ?? undefined;
    const to = c.req.query("toBranchId") ?? undefined;
    const status = c.req.query("status") ?? undefined;
    const perms = c.get("permissions") as string[];
    if ((!from && !to) && !perms.includes(PERMISSIONS.BRANCHES_MANAGE))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "fromBranchId or toBranchId required without branches:manage" } }, 403);
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (from) { conds.push("from_branch_id = ?"); vals.push(from); }
    if (to) { conds.push("to_branch_id = ?"); vals.push(to); }
    if (status) { conds.push("status = ?"); vals.push(status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { results } = await c.env.DB.prepare(`SELECT id, number, from_branch_id, to_branch_id, status, requested_by, created_at FROM transfers ${where} ORDER BY created_at DESC LIMIT 50`).bind(...vals).all();
    return c.json({ success: true, data: results ?? [] }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = requestTransferSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid transfer" } }, 400);
    try {
      const data = await requestTransfer(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await loadTransfer(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/approve", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
    const parsed = approveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "approvedBy required" } }, 400);
    try {
      await approveTransfer(c.env.DB, c.req.param("id"), parsed.data.approvedBy, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/dispatch", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    try {
      await dispatchTransfer(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/receive", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = receiveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "barcodes required" } }, 400);
    try {
      const data = await receiveLines(c.env.DB, c.req.param("id"), parsed.data.barcodes, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/recall", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = recallSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "productIds required" } }, 400);
    try {
      await recallLines(c.env.DB, c.req.param("id"), parsed.data.productIds, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = reasonSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    try {
      await cancelTransfer(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/reconcile", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await reconcileTransfer(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  });
