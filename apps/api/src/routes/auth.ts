import { Hono } from "hono";
import { loginSchema } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { writeAudit } from "../middleware/audit";
import { createSession, destroySession } from "../services/session";
import { verifyPassword } from "../services/hash";

type SessionRow = {
  user_id: string;
  expires_at: number;
  created_at: number;
  is_active: number;
};

const SESSION_RE = /(?:^|;\s*)session=([^;]+)/;

function sessionCookie(id: string, maxAge: number): string {
  return `session=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
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
    const user = await c.env.DB.prepare(
      "SELECT id, email, name, password_hash, is_active FROM users WHERE email = ?"
    )
      .bind(parsed.data.email)
      .first<{ id: string; email: string; name: string; password_hash: string; is_active: number }>();
    if (!user || !user.is_active) {
      return c.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
        401
      );
    }
    const ok = await verifyPassword(parsed.data.password, user.password_hash);
    if (!ok) {
      return c.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
        401
      );
    }
    const session = await createSession(c.env.DB, user.id);
    await writeAudit(c.env.DB, {
      userId: user.id,
      action: "auth.login",
      entity: "session",
      entityId: session.id,
      ip: c.req.header("cf-connecting-ip") ?? undefined,
    });
    c.header("Set-Cookie", sessionCookie(session.id, 12 * 60 * 60));
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
  });

export type { SessionRow };
