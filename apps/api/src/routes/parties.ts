import { Hono } from "hono";
import { z } from "zod";
import { createPartySchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { createParty, getPartyDetail, listParties, updateParty, type PartyTable } from "../services/parties";
import { partyLedger } from "../services/journal";
import { pagination, serviceError } from "./http";

const updatePartySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  creditLimit: z.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
  reason: z.string().max(500).optional(),
});

const statusSchema = z.object({
  isActive: z.union([z.literal(0), z.literal(1)]),
  reason: z.string().min(1).max(500),
});

function partyRouter(table: PartyTable) {
  return new Hono<{ Bindings: Env; Variables: AppVariables }>()
    .use(requireAuth)
    .post("/", requirePerm(PERMISSIONS.MASTERS_CREATE), async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = createPartySchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { success: false, error: { code: "VALIDATION", message: "Invalid data" } },
          400
        );
      try {
        const row = await createParty(c.env.DB, table, parsed.data, c.get("userId"));
        return c.json({ success: true, data: row }, 201);
      } catch (err) {
        return serviceError(c, err);
      }
    })
    .get("/", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
      const perms = c.get("permissions") as string[];
      const canManageAll = perms.includes(PERMISSIONS.BRANCHES_MANAGE);
      const data = await listParties(c.env.DB, table, c.get("userId"), canManageAll, pagination(c));
      return c.json({ success: true, data }, 200);
    })
    .patch("/:id", requirePerm(PERMISSIONS.MASTERS_EDIT), async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = updatePartySchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { success: false, error: { code: "VALIDATION", message: "Invalid data" } },
          400
        );
      try {
        await updateParty(
          c.env.DB,
          table,
          c.req.param("id"),
          {
            name: parsed.data.name,
            phone: parsed.data.phone,
            address: parsed.data.address,
            creditLimit: parsed.data.creditLimit,
            notes: parsed.data.notes,
          },
          c.get("userId"),
          parsed.data.reason
        );
        return c.json({ success: true, data: { ok: true } }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    })
    .patch("/:id/status", requirePerm(PERMISSIONS.MASTERS_CANCEL), async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = statusSchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { success: false, error: { code: "VALIDATION", message: "isActive and reason required" } },
          400
        );
      try {
        await updateParty(
          c.env.DB,
          table,
          c.req.param("id"),
          { isActive: parsed.data.isActive },
          c.get("userId"),
          parsed.data.reason
        );
        return c.json({ success: true, data: { ok: true } }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    })
    .get("/:id", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
      try {
        const data = await getPartyDetail(c.env.DB, table, c.req.param("id"));
        return c.json({ success: true, data }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    })
    .get("/:id/ledger", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
      try {
        const account = table === "customers" ? "1200" : "2000";
        const partyType = table === "customers" ? "customer" : "supplier";
        const data = await partyLedger(c.env.DB, account, partyType, c.req.param("id"));
        return c.json({ success: true, data }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    });
}

export const suppliers = partyRouter("suppliers");
export const customers = partyRouter("customers");
