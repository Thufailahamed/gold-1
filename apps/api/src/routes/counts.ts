import { Hono } from "hono";
import { z } from "zod";
import { approveCountSchema, PERMISSIONS, scanSchema, startCountSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { approveCount, cancelCount, compare, getCount, listCounts, recordScan, startCount, addNote } from "../services/counts";
import { assertBranchAccess, branchScope, eligibleApprovers, inScope } from "../services/branchAccess";
import { serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

const noteSchema = z.object({ productId: z.string().min(1), note: z.string().trim().min(1).max(500) });
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });

type Ctx = { env: Env; get: (k: "userId" | "permissions") => unknown };

/** Every per-count action is limited to members of the count's branch. */
async function guardCount(c: Ctx, countId: string): Promise<void> {
  const row = await getShopDb(c).prepare("SELECT branch_id FROM stock_counts WHERE id = ?").bind(countId).first<{ branch_id: string }>();
  if (!row) throw Object.assign(new Error("Count not found"), { code: "NOT_FOUND" });
  await assertBranchAccess(getShopDb(c), c.get("userId") as string, c.get("permissions") as string[], row.branch_id, "this count's branch");
}

export const counts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    const branchId = c.req.query("branchId") || undefined;
    const status = c.req.query("status") || undefined;
    const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions") as string[]);
    if (branchId && !inScope(scope, branchId))
      return c.json({ success: false, error: { code: "FORBIDDEN", message: "You are not a member of that branch" } }, 403);
    const data = await listCounts(getShopDb(c), { branchIds: branchId ? [branchId] : (scope ?? undefined), status });
    return c.json({ success: true, data }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = startCountSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid count" } }, 400);
    try {
      await assertBranchAccess(getShopDb(c), c.get("userId"), c.get("permissions") as string[], parsed.data.branchId);
      const data = await startCount(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      await guardCount(c, c.req.param("id"));
      return c.json({ success: true, data: await getCount(getShopDb(c), c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/scans", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = scanSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "barcode required" } }, 400);
    try {
      await guardCount(c, c.req.param("id"));
      const data = await recordScan(getShopDb(c), c.req.param("id"), parsed.data.barcode, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/compare", requirePerm(PERMISSIONS.PRODUCTS_VIEW), async (c) => {
    try {
      await guardCount(c, c.req.param("id"));
      return c.json({ success: true, data: await compare(getShopDb(c), c.req.param("id")) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/notes", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = noteSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "productId and note required" } }, 400);
    try {
      await guardCount(c, c.req.param("id"));
      await addNote(getShopDb(c), c.req.param("id"), parsed.data.productId, parsed.data.note, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/approve", requirePerm(PERMISSIONS.PRODUCTS_CANCEL), async (c) => {
    const parsed = approveCountSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "A reason is required" } }, 400);
    try {
      await guardCount(c, c.req.param("id"));
      const data = await approveCount(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.PRODUCTS_EDIT), async (c) => {
    const parsed = reasonSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    try {
      await guardCount(c, c.req.param("id"));
      await cancelCount(getShopDb(c), c.req.param("id"), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  });
