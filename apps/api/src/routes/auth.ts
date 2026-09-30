import { Hono } from "hono";
import {
  changePasswordSchema,
  loginSchema,
  PERMISSIONS,
  resetConfirmSchema,
  resetRequestSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { writeAudit } from "../middleware/audit";
import { createSession, destroySession, SESSION_ABSOLUTE_MS } from "../services/session";
import { verifyPassword } from "../services/hash";
import { changePassword, confirmReset, requestReset } from "../services/password";
import { clearFailures, lockedFor, loginKeys, recordFailure } from "../services/throttle";
import { serviceError } from "./http";

// Well-formed but matches no password: lets a failed lookup cost the same
// scrypt run as a real check.
const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

type SessionRow = {
  user_id: string;
  expires_at: number;
  created_at: number;
  is_active: number;
};

const SESSION_RE = /(?:^|;\s*)session=([^;]+)/;

export function sessionCookie(id: string, maxAge: number): string {
  // SameSite=None so the browser sends the cookie cross-site (web app on a
  // different origin than the API). Requires Secure; localhost is a secure
  // context so local development keeps working.
  return `session=${id}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}

export const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .post("/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid email or password" } },
        400
      );
    }
    const ip = c.req.header("cf-connecting-ip") ?? undefined;
    const keys = loginKeys(parsed.data.email, ip);
    const wait = await lockedFor(c.env.DB, keys);
    if (wait > 0) {
      c.header("Retry-After", String(Math.ceil(wait / 1000)));
      return c.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many failed attempts. Try again in a few minutes." },
        },
        429
      );
    }
    const user = await c.env.DB.prepare(
      "SELECT id, email, name, password_hash, is_active FROM users WHERE email = ?"
    )
      .bind(parsed.data.email)
      .first<{ id: string; email: string; name: string; password_hash: string; is_active: number }>();
    // Unknown and inactive users still pay for one scrypt run, so response
    // time does not reveal which emails have accounts.
    const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !user.is_active || !ok) {
      await recordFailure(c.env.DB, keys);
      return c.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
        401
      );
    }
    await clearFailures(c.env.DB, parsed.data.email);
    const session = await createSession(c.env.DB, user.id);
    await writeAudit(c.env.DB, {
      userId: user.id,
      action: "auth.login",
      entity: "session",
      entityId: session.id,
      ip,
    });
    c.header("Set-Cookie", sessionCookie(session.id, SESSION_ABSOLUTE_MS / 1000));
    return c.json(
      {
        success: true,
        data: { user: { id: user.id, email: user.email, name: user.name } },
      },
      200
    );
  })
  .post("/logout", requireAuth, async (c) => {
    const sessionId = c.req.header("cookie")?.match(SESSION_RE)?.[1];
    if (sessionId) await destroySession(c.env.DB, sessionId);
    await writeAudit(c.env.DB, {
      userId: c.get("userId"),
      action: "auth.logout",
      entity: "session",
      entityId: sessionId ?? "unknown",
    });
    c.header("Set-Cookie", sessionCookie("", 0));
    return c.json({ success: true, data: { ok: true } }, 200);
  })
  .get("/me", requireAuth, async (c) => {
    const userId = c.get("userId");
    const user = await c.env.DB.prepare(
      "SELECT id, email, name FROM users WHERE id = ? AND is_active = 1"
    )
      .bind(userId)
      .first<{ id: string; email: string; name: string }>();
    if (!user) {
      return c.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Session expired" } },
        401
      );
    }
    const { results } = await c.env.DB.prepare(
      "SELECT branch_id FROM branch_members WHERE user_id = ?"
    )
      .bind(userId)
      .all<{ branch_id: string }>();
    return c.json(
      {
        success: true,
        data: {
          user,
          permissions: c.get("permissions"),
          branchIds: (results ?? []).map((r) => r.branch_id),
        },
      },
      200
    );
  })
  .post("/change-password", requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid password data" } },
        400
      );
    try {
      await changePassword(
        c.env.DB,
        c.get("userId"),
        parsed.data.currentPassword,
        parsed.data.newPassword
      );
      c.header("Set-Cookie", sessionCookie("", 0));
      return c.json({ success: true, data: { ok: true, relogin: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/reset-request", requireAuth, requirePerm(PERMISSIONS.USERS_EDIT), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = resetRequestSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid email" } },
        400
      );
    try {
      const { token, userId } = await requestReset(c.env.DB, parsed.data.email, c.get("userId"));
      return c.json(
        {
          success: true,
          data: { userId, token, expiresInMinutes: 15, deliverSecurely: true },
        },
        201
      );
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/reset-confirm", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = resetConfirmSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid reset data" } },
        400
      );
    try {
      await confirmReset(c.env.DB, parsed.data.token, parsed.data.newPassword);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });

export type { SessionRow };
