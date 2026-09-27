import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { getSetting, putSetting } from "../services/settings";
import { serviceError } from "./http";

const putSettingSchema = z.object({
  value: z.unknown(),
  type: z.enum(["string", "number", "boolean", "json"]),
});

export const settings = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/:key", async (c) => {
    const data = await getSetting(c.env.DB, c.req.param("key"));
    if (!data)
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Setting not found" } },
        404
      );
    return c.json({ success: true, data }, 200);
  })
  .put("/:key", requirePerm(PERMISSIONS.SETTINGS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = putSettingSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid setting data" } },
        400
      );
    try {
      await putSetting(c.env.DB, c.req.param("key"), parsed.data.value, parsed.data.type, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
