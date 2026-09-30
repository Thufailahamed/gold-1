import { createMiddleware } from "hono/factory";
import { platformPermissionsFor } from "@goldos/shared";
import type { Env } from "../db/client";
import { sha256Hex, type PlatformEnv } from "./core";

export const PLATFORM_COOKIE = "psession";
/** Staff sessions are shorter than shop sessions: 8h idle, 24h absolute. */
export const PSESSION_IDLE_MS = 1000 * 60 * 60 * 8;
export const PSESSION_ABSOLUTE_MS = 1000 * 60 * 60 * 24;
/** Sliding the idle window costs a write, so it happens at most this often. */
const TOUCH_EVERY_MS = 1000 * 60 * 5;

const COOKIE_RE = /(?:^|;\s*)psession=([^;]+)/;

export function readPlatformToken(cookieHeader: string | undefined): string | null {
  return cookieHeader?.match(COOKIE_RE)?.[1] ?? null;
}

/**
 * Path=/platform keeps the staff cookie off every shop endpoint, so a
 * platform session can never be mistaken for, or leak into, a tenant request.
 */
export function platformCookie(token: string, maxAgeSec: number): string {
  return `${PLATFORM_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Path=/platform; Max-Age=${maxAgeSec}`;
}

const unauthorized = (message: string) => ({
  success: false as const,
  error: { code: "UNAUTHORIZED", message },
});

/** Rejects every platform request when the control-plane database is not bound. */
export const requirePlatformDb = createMiddleware<PlatformEnv>(async (c, next) => {
  const pdb = (c.env as Env).PLATFORM_DB;
  if (!pdb) {
    return c.json(
      { success: false, error: { code: "UNAVAILABLE", message: "Control plane is not configured" } },
      503
    );
  }
  c.set("pdb", pdb);
  await next();
});

type SessionRow = {
  id: string;
  admin_id: string;
  mfa_pending: number;
  expires_at: number;
  last_seen_at: number;
  created_at: number;
  name: string;
  role: string;
  is_active: number;
};

async function loadSession(pdb: D1Database, token: string | null): Promise<SessionRow | null> {
  if (!token) return null;
  const row = await pdb
    .prepare(
      `SELECT s.id, s.admin_id, s.mfa_pending, s.expires_at, s.last_seen_at, s.created_at, a.name, a.role, a.is_active
       FROM platform_sessions s JOIN platform_admins a ON a.id = s.admin_id WHERE s.token_hash = ?`
    )
    .bind(await sha256Hex(token))
    .first<SessionRow>();
  const now = Date.now();
  if (!row || row.expires_at < now || row.created_at + PSESSION_ABSOLUTE_MS < now || !row.is_active) return null;
  return row;
}

function makeAuth(opts: { allowMfaPending: boolean }) {
  return createMiddleware<PlatformEnv>(async (c, next) => {
    const pdb = c.get("pdb");
    const row = await loadSession(pdb, readPlatformToken(c.req.header("cookie")));
    if (!row) return c.json(unauthorized("Not authenticated"), 401);
    if (row.mfa_pending && !opts.allowMfaPending)
      return c.json({ success: false, error: { code: "MFA_REQUIRED", message: "Two-factor code required" } }, 401);
    const now = Date.now();
    if (now - row.last_seen_at > TOUCH_EVERY_MS) {
      await pdb
        .prepare("UPDATE platform_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
        .bind(now, now + PSESSION_IDLE_MS, row.id)
        .run();
    }
    c.set("adminId", row.admin_id);
    c.set("adminName", row.name);
    c.set("adminRole", row.role);
    c.set("platformPermissions", platformPermissionsFor(row.role));
    c.set("sessionId", row.id);
    await next();
  });
}

export const requirePlatformAuth = makeAuth({ allowMfaPending: false });
/** Only for the second login step: the session exists but MFA is not yet proven. */
export const requirePlatformPartialAuth = makeAuth({ allowMfaPending: true });

export const requirePlatformPerm = (perm: string) =>
  createMiddleware<PlatformEnv>(async (c, next) => {
    if (!(c.get("platformPermissions") ?? []).includes(perm)) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Insufficient permission" } },
        403
      );
    }
    await next();
  });

export function clientIp(c: { req: { header: (n: string) => string | undefined } }): string | null {
  return c.req.header("cf-connecting-ip") ?? null;
}
