import { Hono } from "hono";
import { z } from "zod";
import { createBranchSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { createBranch, listBranches, updateBranch } from "../services/branches";
import { pagination, serviceError } from "./http";

const updateBranchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().max(500).optional(),
  isActive: z.union([z.literal(0), z.literal(1)]).optional(),
  reason: z.string().max(500).optional(),
});

export const branches = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.BRANCHES_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createBranchSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid branch data" } },
        400
      );
    try {
      const branch = await createBranch(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: branch }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/", async (c) => {
    const perms = c.get("permissions") as string[];
    const canManageAll = perms.includes(PERMISSIONS.BRANCHES_MANAGE);
    const data = await listBranches(c.env.DB, c.get("userId"), canManageAll, pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .patch("/:id", requirePerm(PERMISSIONS.BRANCHES_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateBranchSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid branch data" } },
        400
      );
    try {
      await updateBranch(
        c.env.DB,
        c.req.param("id"),
        { name: parsed.data.name, address: parsed.data.address, isActive: parsed.data.isActive },
        c.get("userId"),
        parsed.data.reason
      );
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
