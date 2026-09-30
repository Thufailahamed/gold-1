import { Hono } from "hono";
import {
  platformBootstrapSchema,
  platformLoginSchema,
  platformMfaSchema,
  platformPasswordSchema,
} from "@goldos/shared";
import { serviceError } from "../../routes/http";
import {
  clientIp,
  platformCookie,
  PSESSION_IDLE_MS,
  requirePlatformAuth,
  requirePlatformPartialAuth,
} from "../auth";
import { getPlatformSettings, type PlatformEnv } from "../core";
import { ok, parseBody } from "../http";
import {
  beginMfaEnrolment,
  bootstrap,
  bootstrapStatus,
  changeOwnPassword,
  completeMfa,
  confirmMfaEnrolment,
  disableOwnMfa,
  getMe,
  listSessions,
  login,
  logout,
  revokeSession,
} from "../services/admins";

const IDLE_SEC = Math.floor(PSESSION_IDLE_MS / 1000);

export const platformAuth = new Hono<PlatformEnv>()
  .get("/bootstrap", async (c) => ok(c, await bootstrapStatus(c.get("pdb"))))
  .post("/bootstrap", async (c) => {
    const p = await parseBody(c, platformBootstrapSchema);
    if (!p.ok) return p.res;
    try {
      return ok(c, await bootstrap(c.get("pdb"), c.env.PLATFORM_BOOTSTRAP_TOKEN, p.data, clientIp(c)), 201);
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/login", async (c) => {
    const p = await parseBody(c, platformLoginSchema);
    if (!p.ok) return p.res;
    try {
      const r = await login(c.get("pdb"), p.data.email, p.data.password, clientIp(c), c.req.header("user-agent") ?? null);
      c.header("Set-Cookie", platformCookie(r.token, IDLE_SEC));
      return ok(c, { mfaRequired: r.mfaRequired, admin: r.admin });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/mfa", requirePlatformPartialAuth, async (c) => {
    const p = await parseBody(c, platformMfaSchema);
    if (!p.ok) return p.res;
    try {
      await completeMfa(c.get("pdb"), c.get("sessionId"), c.get("adminId"), p.data.code, clientIp(c));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/logout", requirePlatformPartialAuth, async (c) => {
    await logout(c.get("pdb"), c.get("sessionId"), c.get("adminId"));
    c.header("Set-Cookie", platformCookie("", 0));
    return ok(c, { ok: true });
  })
  .get("/me", requirePlatformAuth, async (c) => {
    try {
      const me = await getMe(c.get("pdb"), c.get("adminId"));
      const settings = await getPlatformSettings(c.get("pdb"));
      return ok(c, { admin: me, permissions: me.permissions, company: settings.company_name, maintenance: settings.maintenance_mode });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/password", requirePlatformAuth, async (c) => {
    const p = await parseBody(c, platformPasswordSchema);
    if (!p.ok) return p.res;
    try {
      await changeOwnPassword(c.get("pdb"), c.get("adminId"), p.data.currentPassword, p.data.newPassword, c.get("sessionId"));
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/mfa/enroll", requirePlatformAuth, async (c) => {
    try {
      const settings = await getPlatformSettings(c.get("pdb"));
      return ok(c, await beginMfaEnrolment(c.get("pdb"), c.get("adminId"), `${settings.company_name} Platform`));
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/mfa/confirm", requirePlatformAuth, async (c) => {
    const p = await parseBody(c, platformMfaSchema);
    if (!p.ok) return p.res;
    try {
      await confirmMfaEnrolment(c.get("pdb"), c.get("adminId"), p.data.code);
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .post("/mfa/disable", requirePlatformAuth, async (c) => {
    const p = await parseBody(c, platformMfaSchema);
    if (!p.ok) return p.res;
    try {
      await disableOwnMfa(c.get("pdb"), c.get("adminId"), p.data.code);
      return ok(c, { ok: true });
    } catch (e) {
      return serviceError(c, e);
    }
  })
  .get("/sessions", requirePlatformAuth, async (c) => {
    const rows = await listSessions(c.get("pdb"), c.get("adminId"));
    return ok(c, rows.map((r) => ({ ...r, current: r.id === c.get("sessionId") })));
  })
  .delete("/sessions/:id", requirePlatformAuth, async (c) => {
    if (c.req.param("id") === c.get("sessionId"))
      return c.json({ success: false, error: { code: "CONFLICT", message: "Use sign out for the current session" } }, 409);
    await revokeSession(c.get("pdb"), c.get("adminId"), c.req.param("id"));
    return ok(c, { ok: true });
  });
