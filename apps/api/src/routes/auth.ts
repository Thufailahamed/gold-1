import { Hono } from "hono";
import {
  changePasswordSchema,
  loginSchema,
  PERMISSIONS,
  resetConfirmSchema,
  resetRequestSchema,
  shopLoginSchema,
  shopLookupSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { extractSessionId, requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { writeAudit } from "../middleware/audit";
import { createSession, destroySession, SESSION_ABSOLUTE_MS } from "../services/session";
import { verifyPassword } from "../services/hash";
import { changePassword, confirmReset, requestReset } from "../services/password";
import { clearFailures, lockedFor, loginKeys, recordFailure } from "../services/throttle";
import { serviceError } from "./http";
import { getShopDb, getTenantId, resolveShopDb, tenantCookie, TENANT_COOKIE, TenantResolveError } from "../platform/resolve";
import { checkPublicThrottle } from "../platform/publicThrottle";

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
    const rawSlug = (body as { slug?: unknown } | null)?.slug;
    const slug = typeof rawSlug === "string" && rawSlug.trim() !== "" ? rawSlug : undefined;
    const parsed = (slug ? shopLoginSchema : loginSchema).safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "Invalid email or password" } },
        400
      );
    }
    // Shop-picker login resolves the workspace first; the password is then
    // checked against exactly that shop's database. Without a slug the
    // request keeps the legacy single-shop behavior.
    let db = getShopDb(c);
    if (slug) {
      if (!c.env.PLATFORM_DB)
        return c.json({ success: false, error: { code: "UNAVAILABLE", message: "Shop login is not available on this deployment" } }, 503);
      try {
        ({ db } = await resolveShopDb(c.env, slug));
      } catch (e) {
        if (e instanceof TenantResolveError)
          return c.json({ success: false, error: { code: e.code, message: e.message } }, e.status as 401);
        throw e;
      }
    }
    const ip = c.req.header("cf-connecting-ip") ?? undefined;
    const keys = loginKeys(parsed.data.email, ip);
    const wait = await lockedFor(db, keys);
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
    const user = await db.prepare(
      "SELECT id, email, name, password_hash, is_active FROM users WHERE email = ?"
    )
      .bind(parsed.data.email)
      .first<{ id: string; email: string; name: string; password_hash: string; is_active: number }>();
    // Unknown and inactive users still pay for one scrypt run, so response
    // time does not reveal which emails have accounts.
    const ok = await verifyPassword(parsed.data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !user.is_active || !ok) {
      await recordFailure(db, keys);
      return c.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
        401
      );
    }
    await clearFailures(db, parsed.data.email);
    const session = await createSession(db, user.id);
    await writeAudit(db, {
      userId: user.id,
      action: "auth.login",
      entity: "session",
      entityId: session.id,
      ip,
    });
    c.header("Set-Cookie", sessionCookie(session.id, SESSION_ABSOLUTE_MS / 1000));
    if (slug) c.header("Set-Cookie", tenantCookie(slug), { append: true });
    c.header("X-Session-Id", session.id);
    return c.json(
      {
        success: true,
        data: {
          user: { id: user.id, email: user.email, name: user.name },
          token: session.id,
          sessionId: session.id,
        },
      },
      200
    );
  })
  .post("/lookup", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = shopLookupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { success: false, error: { code: "VALIDATION", message: "A valid email is required" } },
        400
      );
    }
    const pdb = c.env.PLATFORM_DB;
    // Single-shop deploys have no picker: the only shop is the current one.
    if (!pdb) return c.json({ success: true, data: { shops: [] } }, 200);
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    if (!(await checkPublicThrottle(pdb, `lookup:${ip}`, 20, 60_000))) {
      c.header("Retry-After", "60");
      return c.json(
        { success: false, error: { code: "RATE_LIMITED", message: "Too many lookups. Try again in a little while." } },
        429
      );
    }
    // Index-only: one query whether the email is known or not, slugs only.
    const { results } = await pdb.prepare(
      `SELECT t.slug AS slug, t.name AS name FROM tenant_members m
       JOIN tenants t ON t.id = m.tenant_id
       WHERE m.email = ? AND t.status IN ('ACTIVE', 'SUSPENDED')
       ORDER BY t.created_at`
    )
      .bind(parsed.data.email.toLowerCase())
      .all<{ slug: string; name: string }>();
    return c.json({ success: true, data: { shops: results ?? [] } }, 200);
  })
  .post("/logout", requireAuth, async (c) => {
    const sessionId = extractSessionId(c);
    if (sessionId) await destroySession(getShopDb(c), sessionId);
    await writeAudit(getShopDb(c), {
      userId: c.get("userId"),
      action: "auth.logout",
      entity: "session",
      entityId: sessionId ?? "unknown",
    });
    c.header("Set-Cookie", sessionCookie("", 0));
    c.header("Set-Cookie", `${TENANT_COOKIE}=; Path=/; Max-Age=0`, { append: true });
    return c.json({ success: true, data: { ok: true } }, 200);
  })
  .get("/me", requireAuth, async (c) => {
    const userId = c.get("userId");
    const shopDb = getShopDb(c);
    const user = await shopDb.prepare(
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
    const { results } = await shopDb.prepare(
      "SELECT branch_id FROM branch_members WHERE user_id = ?"
    )
      .bind(userId)
      .all<{ branch_id: string }>();
    const tenantId = getTenantId(c);
    const tenant = tenantId && c.env.PLATFORM_DB
      ? await c.env.PLATFORM_DB.prepare("SELECT id, slug, name FROM tenants WHERE id = ?").bind(tenantId).first<{ id: string; slug: string; name: string }>()
      : null;
    return c.json(
      {
        success: true,
        data: {
          user,
          permissions: c.get("permissions"),
          branchIds: (results ?? []).map((r) => r.branch_id),
          tenant: tenant ?? null,
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
        getShopDb(c),
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
      const { token, userId } = await requestReset(getShopDb(c), parsed.data.email, c.get("userId"));
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
      await confirmReset(getShopDb(c), parsed.data.token, parsed.data.newPassword);
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  });

export type { SessionRow };
