import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS, requestTransferSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { approveTransfer, cancelTransfer, dispatchTransfer, getTransferDetail, listTransfers, receiveLines, recallLines, reconcileTransfer, requestTransfer } from "../services/transfers";
import { branchScope, eligibleApprovers, inScope } from "../services/branchAccess";
import { serviceError } from "./http";

const approveSchema = z.object({ approvedBy: z.string().min(1) });
const receiveSchema = z.object({ barcodes: z.array(z.string().min(1).max(32)).min(1).max(100) });
const recallSchema = z.object({ productIds: z.array(z.string().min(1)).min(1).max(100) });
const reasonSchema = z.object({ reason: z.string().min(1).max(500) });

type Ctx = { env: Env; get: (k: "userId" | "permissions") => unknown };
type Side = "sender" | "receiver" | "either";

/**
 * The sending branch approves, dispatches, recalls and cancels; the receiving
 * branch receives. Anyone at either end may read. branches:manage covers all.
 */
async function guardTransfer(c: Ctx, id: string, side: Side): Promise<void> {
  const t = await c.env.DB.prepare("SELECT from_branch_id, to_branch_id FROM transfers WHERE id = ?").bind(id).first<{ from_branch_id: string; to_branch_id: string }>();
  if (!t) throw Object.assign(new Error("Transfer not found"), { code: "NOT_FOUND" });
  const scope = await branchScope(c.env.DB, c.get("userId") as string, c.get("permissions") as string[]);
  const ok =
    side === "sender" ? inScope(scope, t.from_branch_id)
    : side === "receiver" ? inScope(scope, t.to_branch_id)
    : inScope(scope, t.from_branch_id) || inScope(scope, t.to_branch_id);
  if (!ok) {
    const where = side === "sender" ? "the sending branch" : side === "receiver" ? "the receiving branch" : "either branch";
    throw Object.assign(new Error(`Only members of ${where} can do this`), { code: "FORBIDDEN" });
  }
}

export const stockTransferRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const from = c.req.query("fromBranchId") || undefined;
    const to = c.req.query("toBranchId") || undefined;
    const status = c.req.query("status") || undefined;
    const scope = await branchScope(c.env.DB, c.get("userId"), c.get("permissions") as string[]);
    const data = await listTransfers(c.env.DB, { fromBranchId: from, toBranchId: to, status, scope });
    return c.json({ success: true, data }, 200);
  })
  // Destinations: every active branch, not just the caller's own — a clerk
  // sends stock to branches they do not work in. Names only, no stock data.
  .get("/branches", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const scope = await branchScope(c.env.DB, c.get("userId"), c.get("permissions") as string[]);
    const { results } = await c.env.DB.prepare("SELECT id, name, code FROM branches WHERE is_active = 1 ORDER BY name").all<{ id: string; name: string; code: string }>();
    return c.json({ success: true, data: (results ?? []).map((b) => ({ ...b, member: inScope(scope, b.id) })) }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = requestTransferSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid transfer" } }, 400);
    try {
      const scope = await branchScope(c.env.DB, c.get("userId"), c.get("permissions") as string[]);
      if (!inScope(scope, parsed.data.fromBranchId) && !inScope(scope, parsed.data.toBranchId))
        return c.json({ success: false, error: { code: "FORBIDDEN", message: "You must belong to the sending or receiving branch" } }, 403);
      const data = await requestTransfer(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      await guardTransfer(c, c.req.param("id"), "either");
      return c.json({ success: true, data: await getTransferDetail(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/approvers", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      await guardTransfer(c, c.req.param("id"), "either");
      const t = await c.env.DB.prepare("SELECT from_branch_id, requested_by FROM transfers WHERE id = ?").bind(c.req.param("id")).first<{ from_branch_id: string; requested_by: string | null }>();
      const data = await eligibleApprovers(c.env.DB, PERMISSIONS.PRODUCTS_CANCEL, { branchId: t?.from_branch_id, exclude: [t?.requested_by] });
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/approve", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
    const parsed = approveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "approvedBy required" } }, 400);
    try {
      await guardTransfer(c, c.req.param("id"), "sender");
      await approveTransfer(c.env.DB, c.req.param("id"), parsed.data.approvedBy, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/dispatch", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    try {
      await guardTransfer(c, c.req.param("id"), "sender");
      await dispatchTransfer(c.env.DB, c.req.param("id"), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/receive", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = receiveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "barcodes required" } }, 400);
    try {
      await guardTransfer(c, c.req.param("id"), "receiver");
      const data = await receiveLines(c.env.DB, c.req.param("id"), parsed.data.barcodes, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/recall", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = recallSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "productIds required" } }, 400);
    try {
      await guardTransfer(c, c.req.param("id"), "sender");
      await recallLines(c.env.DB, c.req.param("id"), parsed.data.productIds, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = reasonSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    try {
      await guardTransfer(c, c.req.param("id"), "sender");
      await cancelTransfer(c.env.DB, c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/reconcile", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      await guardTransfer(c, c.req.param("id"), "either");
      return c.json({ success: true, data: await reconcileTransfer(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  });
