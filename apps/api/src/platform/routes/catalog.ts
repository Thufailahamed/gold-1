import { Hono } from "hono";
import {
  announcementSchema,
  editFlagSchema,
  editPlanSchema,
  flagSchema,
  PLATFORM_PERMISSIONS as P,
  planSchema,
} from "@goldos/shared";
import { serviceError } from "../../routes/http";
import { requirePlatformAuth, requirePlatformPerm } from "../auth";
import type { PlatformEnv } from "../core";
import { actor, ok, parseBody } from "../http";
import {
  createFlag,
  createPlan,
  deleteFlag,
  editFlag,
  editPlan,
  listAnnouncements,
  listFlags,
  listPlans,
  saveAnnouncement,
  setAnnouncementStatus,
} from "../services/catalog";

export const platformPlans = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.TENANTS_VIEW), async (c) =>
    ok(c, await listPlans(c.get("pdb"), { includeArchived: c.req.query("all") === "1" }))
  )
  .post("/", requirePlatformPerm(P.PLANS_MANAGE), async (c) => {
    const p = await parseBody(c, planSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await createPlan(c.get("pdb"), p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .patch("/:id", requirePlatformPerm(P.PLANS_MANAGE), async (c) => {
    const p = await parseBody(c, editPlanSchema);
    if (!p.ok) return p.res;
    try {
      await editPlan(c.get("pdb"), c.req.param("id"), p.data, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  });

export const platformFlags = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.TENANTS_VIEW), async (c) => ok(c, await listFlags(c.get("pdb"))))
  .post("/", requirePlatformPerm(P.FLAGS_MANAGE), async (c) => {
    const p = await parseBody(c, flagSchema);
    if (!p.ok) return p.res;
    try {
      await createFlag(c.get("pdb"), p.data, actor(c));
      return ok(c, { ok: true }, 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .patch("/:key", requirePlatformPerm(P.FLAGS_MANAGE), async (c) => {
    const p = await parseBody(c, editFlagSchema);
    if (!p.ok) return p.res;
    try {
      await editFlag(c.get("pdb"), c.req.param("key"), p.data, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .delete("/:key", requirePlatformPerm(P.FLAGS_MANAGE), async (c) => {
    try {
      await deleteFlag(c.get("pdb"), c.req.param("key"), actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  });

export const platformAnnouncements = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.TENANTS_VIEW), async (c) =>
    ok(c, await listAnnouncements(c.get("pdb"), c.req.query("status") || undefined))
  )
  .post("/", requirePlatformPerm(P.ANNOUNCEMENTS_MANAGE), async (c) => {
    const p = await parseBody(c, announcementSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await saveAnnouncement(c.get("pdb"), null, p.data, actor(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .patch("/:id", requirePlatformPerm(P.ANNOUNCEMENTS_MANAGE), async (c) => {
    const p = await parseBody(c, announcementSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await saveAnnouncement(c.get("pdb"), c.req.param("id"), p.data, actor(c)));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/:action{publish|archive|unpublish}", requirePlatformPerm(P.ANNOUNCEMENTS_MANAGE), async (c) => {
    const status = ({ publish: "PUBLISHED", archive: "ARCHIVED", unpublish: "DRAFT" } as const)[
      c.req.param("action") as "publish" | "archive" | "unpublish"
    ];
    try {
      await setAnnouncementStatus(c.get("pdb"), c.req.param("id"), status, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  });
