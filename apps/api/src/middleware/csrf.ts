import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";

/**
 * CSRF guard for cookie-authenticated mutations. The session cookie is
 * SameSite=None (the web app lives on a different origin than the API), so
 * the browser WILL attach it to a cross-site forged request. JSON-only
 * endpoints resist that incidentally (a plain form cannot set
 * Content-Type: application/json), but multipart upload endpoints parse
 * whatever body arrives — a forged cross-site form WOULD reach them.
 *
 * Rule: state-changing methods carrying an Origin or Referer must name an
 * allowlisted web origin. Requests with neither header (curl, native
 * clients, same-origin navigations) pass through untouched.
 */
export const csrf = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");
  if (!origin && !referer) {
    await next();
    return;
  }
  const allowed = (c.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean);
  const originOf = (value: string): string | null => {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      try {
        const end = value.indexOf("/", value.indexOf("://") + 3);
        return end === -1 ? value : value.slice(0, end);
      } catch {
        return null;
      }
    }
    return value;
  };
  const fromOrigin = origin ?? originOf(referer ?? "");
  if (!fromOrigin || !allowed.includes(fromOrigin)) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "Cross-site request refused" } },
      403
    );
  }
  await next();
});
