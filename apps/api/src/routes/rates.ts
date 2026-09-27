import { Hono } from "hono";
import { createGoldRateSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { createGoldRate, currentGoldRates, listGoldRates } from "../services/rates";
import { pagination, serviceError } from "./http";

export const rates = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.MASTERS_WRITE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createGoldRateSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid rate data" } },
        400
      );
    try {
      const row = await createGoldRate(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/current", requirePerm(PERMISSIONS.MASTERS_READ), async (c) => {
    const data = await currentGoldRates(c.env.DB);
    return c.json({ success: true, data }, 200);
  })
  .get("/", requirePerm(PERMISSIONS.MASTERS_READ), async (c) => {
    const data = await listGoldRates(c.env.DB, pagination(c));
    return c.json({ success: true, data }, 200);
  });
