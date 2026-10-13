import { Hono, type Context } from "hono";
import { z } from "zod";
import { advanceCustomSchema, createCustomOrderSchema, deliverCustomSchema, PERMISSIONS, sourceGoldSchema, startProductionSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { advanceOrder, cancelCustomOrder, createCustomOrder, customOrderBranchId, deliverOrder, getCustomOrder, listCustomOrders, orderLineage, sourceGold, startProduction, syncOrder } from "../services/customOrders";
import { assertBranchAccess, branchScope } from "../services/branchAccess";
import { pagination, serviceError } from "./http";
import { getShopDb } from "../platform/resolve";

const cancelSchema = z.object({ reason: z.string().min(1).max(500), approvedBy: z.string().min(1).optional() });

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;
/** Branch-member rule: an order is only visible to, and movable by, members of its branch. */
const ownOrder = async (c: Ctx) => {
  const id = c.req.param("id") as string;
  await assertBranchAccess(getShopDb(c), c.get("userId"), c.get("permissions"), await customOrderBranchId(getShopDb(c), id), "this order's branch");
  return id;
};

export const customOrderRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    const scope = await branchScope(getShopDb(c), c.get("userId"), c.get("permissions"));
    const data = await listCustomOrders(getShopDb(c), { ...pagination(c), branchId: c.req.query("branchId"), customerId: c.req.query("customerId"), status: c.req.query("status"), scope });
    return c.json({ success: true, data }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.MFG_CREATE), async (c) => {
    const parsed = createCustomOrderSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid custom order" } }, 400);
    try {
      await assertBranchAccess(getShopDb(c), c.get("userId"), c.get("permissions"), parsed.data.branchId);
      const data = await createCustomOrder(getShopDb(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await getCustomOrder(getShopDb(c), await ownOrder(c)) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/advance", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const parsed = advanceCustomSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid advance" } }, 400);
    try {
      const data = await advanceOrder(getShopDb(c), await ownOrder(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/source", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    const parsed = sourceGoldSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid earmark" } }, 400);
    try {
      await sourceGold(getShopDb(c), await ownOrder(c), parsed.data.kind, parsed.data.refId, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/start-production", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    const parsed = startProductionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid production start" } }, 400);
    try {
      const data = await startProduction(getShopDb(c), await ownOrder(c), parsed.data.manufacturingOrderId, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/sync", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    try {
      const data = await syncOrder(getShopDb(c), await ownOrder(c), c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/deliver", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const parsed = deliverCustomSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid delivery" } }, 400);
    try {
      const data = await deliverOrder(getShopDb(c), await ownOrder(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.MFG_EDIT), async (c) => {
    const parsed = cancelSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    try {
      await cancelCustomOrder(getShopDb(c), await ownOrder(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id/lineage", requirePerm(PERMISSIONS.MFG_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await orderLineage(getShopDb(c), await ownOrder(c)) }, 200);
    } catch (err) { return serviceError(c, err); }
  });
