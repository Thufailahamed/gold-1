import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";
import { getShopDb } from "../platform/resolve";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_TOUCH_MS } from "../services/session";

export type AppVariables = {
  userId: string;
  permissions: string[];
  /** Per-request SaaS scope, set by resolveTenant. Absent on unmanaged deploys. */
  tenantId?: string;
  tenantSlug?: string;
  shopDb?: D1Database;
};

type AppEnv = { Bindings: Env; Variables: AppVariables };

const SESSION_RE = /(?:^|;\s*)session=([^;]+)/;

export function extractSessionId(c: { req: { header: (n: string) => string | undefined } }): string | undefined {
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const xSession = c.req.header("x-session-id");
  if (xSession) return xSession;

  const cookie = c.req.header("cookie");
  if (cookie) {
    const matches = [...cookie.matchAll(/(?:^|;\s*)session=([^;]+)/g)];
    if (matches.length > 0) {
      return matches[matches.length - 1]?.[1];
    }
  }

  return undefined;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sessionId = extractSessionId(c);
  if (!sessionId) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      401
    );
  }
  // A session is only valid in the workspace it was minted in: the resolved
  // shop database, never any other account's. No fallback across tenants.
  const shopDb = getShopDb(c);
  // One round trip for the session, its user and the user's permissions: the
  // shop database may be a network hop away, and this runs on every request.
  const { results: rows } = await shopDb.prepare(
    `SELECT s.user_id AS user_id, s.expires_at AS expires_at, s.created_at AS created_at, u.is_active AS is_active, p.name AS perm
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_roles ur ON ur.user_id = s.user_id
     LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE s.id = ?`
  )
    .bind(sessionId)
    .all<{ user_id: string; expires_at: number; created_at: number; is_active: number; perm: string | null }>();
  const row = rows?.[0];
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
    await shopDb.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(slid, sessionId).run();
  }
  const results = rows.filter((r) => r.perm !== null).map((r) => ({ name: r.perm as string }));
  c.set("userId", row.user_id);
  c.set("permissions", [...new Set(results.map((r) => r.name))]);
  await next();
});
