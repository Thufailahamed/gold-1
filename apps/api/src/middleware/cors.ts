import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";

const DEFAULT_ORIGIN = "http://localhost:3000";

/**
 * Cross-origin support for the web app. The browser page (e.g.
 * localhost:3000 or the Pages deployment) calls this API on a different
 * origin, so every response needs explicit ACAO headers and preflights
 * must be answered — otherwise browsers block with "Failed to fetch".
 * Allowed origins come from the WEB_ORIGIN env var (comma-separated).
 */
export const cors = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const allowed = (c.env.WEB_ORIGIN ?? DEFAULT_ORIGIN).split(",").map((s) => s.trim());
  const origin = c.req.header("origin");
  if (origin && allowed.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
  c.header("Access-Control-Expose-Headers", "Idempotent-Replayed, Retry-After");
  c.header("Access-Control-Max-Age", "86400");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});
