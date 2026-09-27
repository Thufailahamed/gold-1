import { Hono } from "hono";
import { z } from "zod";
import { createUserSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { createUser, deactivateUser, listUsers } from "../services/users";
import { pagination, serviceError } from "./http";

const deactivateSchema = z.object({ reason: z.string().min(1).max(500) });

export const users = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.USERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid user data" } },
        400
      );
    try {
      const user = await createUser(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: user }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/", requirePerm(PERMISSIONS.USERS_READ), async (c) => {
    const data = await listUsers(c.env.DB, pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .patch("/:id/deactivate", requirePerm(PERMISSIONS.USERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deactivateSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await deactivateUser(c.env.DB, c.req.param("id"), c.get("userId"), parsed.data.reason);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
