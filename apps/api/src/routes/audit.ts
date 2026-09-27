import { Hono } from "hono";
import { PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { pagination } from "./http";

export const audit = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.AUDIT_VIEW), async (c) => {
    const { page, limit } = pagination(c);
    const entity = c.req.query("entity");
    const entityId = c.req.query("entityId");
    const userId = c.req.query("userId");
    const offset = (page - 1) * limit;

    const conds: string[] = [];
    const vals: unknown[] = [];
    if (entity) {
      conds.push("entity = ?");
      vals.push(entity);
    }
    if (entityId) {
      conds.push("entity_id = ?");
      vals.push(entityId);
    }
    if (userId) {
      conds.push("user_id = ?");
      vals.push(userId);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

    const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM audit_logs ${where}`)
      .bind(...vals)
      .first<{ total: number }>();
    const { results } = await c.env.DB.prepare(
      `SELECT id, user_id, action, entity, entity_id, prev_json, new_json, reason, ip, branch_id, created_at FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(...vals, limit, offset)
      .all();
    return c.json({ success: true, data: { rows: results ?? [], total: count?.total ?? 0 } }, 200);
  });
