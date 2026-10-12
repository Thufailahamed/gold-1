import { Hono } from "hono";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { HISTORY_RANGES, liveMarket, marketHistory, type HistoryRange } from "../services/market";
import { serviceError } from "./http";

export const market = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/live", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    try {
      const data = await liveMarket(c.env.DB);
      return c.json({ success: true, data }, 200);
    } catch (err) {
      if ((err as { code?: string }).code === "UNAVAILABLE")
        return c.json({ success: false, error: { code: "UNAVAILABLE", message: (err as Error).message } }, 503);
      return serviceError(c, err);
    }
  })
  .get("/history", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
    const symbol = (c.req.query("symbol") ?? "XAU").toUpperCase();
    const range = (c.req.query("range") ?? "7d") as HistoryRange;
    if (!(range in HISTORY_RANGES))
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid range" } }, 400);
    try {
      const data = await marketHistory(c.env.DB, symbol, range);
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
