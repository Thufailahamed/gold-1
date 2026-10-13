import { Hono } from "hono";
import { z } from "zod";
import { createUserSchema, editUserSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import {
  activateUser,
  createUser,
  deactivateUser,
  editUser,
  getUserDetail,
  listUsers,
} from "../services/users";
import { pagination, serviceError } from "./http";
import { getShopDb, getTenantId } from "../platform/resolve";

const reasonSchema = z.object({ reason: z.string().min(1).max(500) });

/**
 * Best-effort login-index upkeep: the shop-picker `lookup` reads
 * `tenant_members`, so staff user changes reflect there. Never blocks the
 * shop write; skipped where there is no control plane (unmanaged deploys).
 */
async function syncMember(c: { env: Env; get: (key: any) => unknown }, email: string, add: boolean): Promise<void> {
  const pdb = c.env.PLATFORM_DB;
  const tenantId = getTenantId(c);
  if (!pdb || !tenantId) return;
  try {
    if (add) {
      await pdb.prepare("INSERT INTO tenant_members (tenant_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (tenant_id, email) DO NOTHING").bind(tenantId, email.toLowerCase(), Date.now()).run();
    } else {
      await pdb.prepare("DELETE FROM tenant_members WHERE tenant_id = ? AND email = ?").bind(tenantId, email.toLowerCase()).run();
    }
  } catch {
    // Index lag only affects picker convenience; login with slug always works.
  }
}

export const users = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .post("/", requirePerm(PERMISSIONS.USERS_CREATE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid user data" } },
        400
      );
    try {
      const user = await createUser(getShopDb(c), parsed.data, c.get("userId"));
      await syncMember(c, parsed.data.email, true);
      return c.json({ success: true, data: user }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/", requirePerm(PERMISSIONS.USERS_VIEW), async (c) => {
    const data = await listUsers(getShopDb(c), pagination(c));
    return c.json({ success: true, data }, 200);
  })
  .get("/:id", requirePerm(PERMISSIONS.USERS_VIEW), async (c) => {
    try {
      const data = await getUserDetail(getShopDb(c), c.req.param("id"));
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id", requirePerm(PERMISSIONS.USERS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = editUserSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid user data" } },
        400
      );
    try {
      await editUser(getShopDb(c), c.req.param("id"), parsed.data, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id/deactivate", requirePerm(PERMISSIONS.USERS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reasonSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await deactivateUser(getShopDb(c), c.req.param("id"), c.get("userId"), parsed.data.reason);
      const detail = await getUserDetail(getShopDb(c), c.req.param("id")).catch(() => null);
      if (detail) await syncMember(c, detail.email, false);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:id/activate", requirePerm(PERMISSIONS.USERS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reasonSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Reason is required" } },
        400
      );
    try {
      await activateUser(getShopDb(c), c.req.param("id"), c.get("userId"), parsed.data.reason);
      const detail = await getUserDetail(getShopDb(c), c.req.param("id")).catch(() => null);
      if (detail) await syncMember(c, detail.email, true);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });
