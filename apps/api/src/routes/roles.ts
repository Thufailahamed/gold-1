import { Hono } from "hono";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { listRoles } from "../services/users";
import { getShopDb } from "../platform/resolve";

export const roles = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.USERS_VIEW), async (c) => {
    const data = await listRoles(getShopDb(c));
    return c.json({ success: true, data }, 200);
  });
