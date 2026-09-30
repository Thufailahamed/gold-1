import { Hono } from "hono";
import { createTicketSchema, editTicketSchema, PLATFORM_PERMISSIONS as P, ticketReplySchema } from "@goldos/shared";
import { serviceError } from "../../routes/http";
import { requirePlatformAuth, requirePlatformPerm } from "../auth";
import type { PlatformEnv } from "../core";
import { actor, ok, page, parseBody } from "../http";
import { createTicket, editTicket, getTicket, listTickets, replyToTicket } from "../services/support";

export const platformSupport = new Hono<PlatformEnv>()
  .use(requirePlatformAuth)
  .get("/", requirePlatformPerm(P.SUPPORT_VIEW), async (c) =>
    ok(
      c,
      await listTickets(c.get("pdb"), {
        ...page(c),
        status: c.req.query("status") || undefined,
        priority: c.req.query("priority") || undefined,
        assigneeId: c.req.query("assignee") === "me" ? c.get("adminId") : c.req.query("assignee") || undefined,
        unassigned: c.req.query("unassigned") === "1",
        tenantId: c.req.query("tenantId") || undefined,
      })
    )
  )
  .post("/", requirePlatformPerm(P.SUPPORT_MANAGE), async (c) => {
    const p = await parseBody(c, createTicketSchema);
    if (!p.ok) return p.res;
    try {
      const a = actor(c);
      return ok(c, await createTicket(c.get("pdb"), p.data, { type: "ADMIN", id: a.id, name: c.get("adminName") }, a), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .get("/:id", requirePlatformPerm(P.SUPPORT_VIEW), async (c) => {
    try {
      return ok(c, await getTicket(c.get("pdb"), c.req.param("id"), { includeInternal: true }));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/:id/replies", requirePlatformPerm(P.SUPPORT_MANAGE), async (c) => {
    const p = await parseBody(c, ticketReplySchema);
    if (!p.ok) return p.res;
    try {
      const a = actor(c);
      await replyToTicket(c.get("pdb"), c.req.param("id"), p.data, { type: "ADMIN", id: a.id, name: c.get("adminName") }, a);
      return ok(c, { ok: true }, 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .patch("/:id", requirePlatformPerm(P.SUPPORT_MANAGE), async (c) => {
    const p = await parseBody(c, editTicketSchema);
    if (!p.ok) return p.res;
    try {
      await editTicket(c.get("pdb"), c.req.param("id"), p.data, actor(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  });
