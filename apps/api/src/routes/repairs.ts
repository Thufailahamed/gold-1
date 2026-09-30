import { Hono, type Context } from "hono";
import { z } from "zod";
import { collectRepairSchema, createRepairSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { assignRepair, cancelRepair, collectRepair, createRepair, finishRepair, getRepair, listRepairs, qcRepair, repairBranchId } from "../services/repairs";
import { assertBranchAccess, branchScope } from "../services/branchAccess";
import { pagination, serviceError } from "./http";

const assignSchema = z.object({ technicianId: z.string().min(1) });
const qcSchema = z.object({ pass: z.boolean(), reason: z.string().max(500).optional() });
const cancelSchema = z.object({ reason: z.string().min(1).max(500) });

type Ctx = Context<{ Bindings: Env; Variables: AppVariables }>;
/** Branch-member rule: a job is only visible to, and movable by, members of its branch. */
const ownJob = async (c: Ctx) => {
  const id = c.req.param("id") as string;
  await assertBranchAccess(c.env.DB, c.get("userId"), c.get("permissions"), await repairBranchId(c.env.DB, id), "this repair's branch");
  return id;
};

export const repairRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    const scope = await branchScope(c.env.DB, c.get("userId"), c.get("permissions"));
    const data = await listRepairs(c.env.DB, { ...pagination(c), branchId: c.req.query("branchId"), customerId: c.req.query("customerId"), status: c.req.query("status"), scope });
    return c.json({ success: true, data }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const parsed = createRepairSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid repair" } }, 400);
    try {
      await assertBranchAccess(c.env.DB, c.get("userId"), c.get("permissions"), parsed.data.branchId);
      const data = await createRepair(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/:id", requirePerm(PERMISSIONS.SALES_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await getRepair(c.env.DB, await ownJob(c)) }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/assign", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const parsed = assignSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "technicianId required" } }, 400);
    try {
      await assignRepair(c.env.DB, await ownJob(c), parsed.data.technicianId, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/finish", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    try {
      await finishRepair(c.env.DB, await ownJob(c), c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/qc", requirePerm(PERMISSIONS.SALES_APPROVE), async (c) => {
    const parsed = qcSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "pass required" } }, 400);
    try {
      await qcRepair(c.env.DB, await ownJob(c), parsed.data.pass, parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/collect", requirePerm(PERMISSIONS.SALES_CREATE), async (c) => {
    const parsed = collectRepairSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid collection" } }, 400);
    try {
      const data = await collectRepair(c.env.DB, await ownJob(c), parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/:id/cancel", requirePerm(PERMISSIONS.SALES_CANCEL), async (c) => {
    const parsed = cancelSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "reason required" } }, 400);
    try {
      await cancelRepair(c.env.DB, await ownJob(c), parsed.data.reason, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) { return serviceError(c, err); }
  });
