import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";

export type AppVariables = {
  userId: string;
  permissions: string[];
};

type AppEnv = { Bindings: Env; Variables: AppVariables };

const SESSION_RE = /(?:^|;\s*)session=([^;]+)/;

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sessionId = c.req.header("cookie")?.match(SESSION_RE)?.[1];
  if (!sessionId) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      401
    );
  }
  const row = await c.env.DB.prepare(
    "SELECT s.id, s.user_id, s.expires_at, u.is_active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?"
  )
    .bind(sessionId)
    .first<{ user_id: string; expires_at: number; is_active: number }>();
  if (!row || row.expires_at < Date.now() || !row.is_active) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Session expired" } },
      401
    );
  }
  const { results } = await c.env.DB.prepare(
    `SELECT p.name AS name FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ?`
  )
    .bind(row.user_id)
    .all<{ name: string }>();
  c.set("userId", row.user_id);
  c.set("permissions", [...new Set((results ?? []).map((r) => r.name))]);
  await next();
});
