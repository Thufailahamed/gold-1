import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_TOUCH_MS } from "../services/session";

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
    "SELECT s.id, s.user_id, s.expires_at, s.created_at, u.is_active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?"
  )
    .bind(sessionId)
    .first<{ user_id: string; expires_at: number; created_at: number; is_active: number }>();
  const now = Date.now();
  if (
    !row ||
    row.expires_at < now ||
    row.created_at + SESSION_ABSOLUTE_MS < now ||
    !row.is_active
  ) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Session expired" } },
      401
    );
  }
  // Sliding idle expiry: activity pushes the 12h idle deadline forward, never
  // past the 7d absolute cap. Written at most once per SESSION_TOUCH_MS so a
  // busy POS does not turn every read into a write.
  const slid = Math.min(now + SESSION_IDLE_MS, row.created_at + SESSION_ABSOLUTE_MS);
  if (slid - row.expires_at >= SESSION_TOUCH_MS) {
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(slid, sessionId).run();
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
