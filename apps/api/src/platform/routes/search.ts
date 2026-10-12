import { Hono } from "hono";
import { PLATFORM_PERMISSIONS as P } from "@goldos/shared";
import { requirePlatformAuth, requirePlatformPerm } from "../auth";
import type { PlatformEnv } from "../core";
import { ok } from "../http";
import { searchPlatform } from "../services/search";

export const platformSearch = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.TENANTS_VIEW), async (c) => {
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    if (!q) return ok(c, { tenants: [], invoices: [], tickets: [], admins: [] });
    const limit = Math.min(25, Math.max(1, Number(c.req.query("limit") ?? "8") || 8));
    const perms: string[] = c.get("platformPermissions") ?? [];
    const full = await searchPlatform(c.get("pdb"), q, limit);
    return ok(c, {
      tenants: full.tenants,
      invoices: perms.includes(P.BILLING_VIEW) ? full.invoices : [],
      tickets: perms.includes(P.SUPPORT_VIEW) ? full.tickets : [],
      admins: perms.includes(P.ADMINS_VIEW) ? full.admins : [],
    });
  });
