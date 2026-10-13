import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";

const DEFAULT_ORIGIN = "http://localhost:3000";

function isAllowedOrigin(origin: string, allowed: string[]): boolean {
  if (allowed.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    if (url.hostname.endsWith(".workers.dev") || url.hostname.endsWith(".pages.dev")) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Cross-origin support for the web app. The browser page (e.g.
 * localhost:3000 or the Workers/Pages deployment) calls this API on a different
 * origin, so every response needs explicit ACAO headers and preflights
 * must be answered — otherwise browsers block with "Failed to fetch".
 * Allowed origins come from the WEB_ORIGIN env var (comma-separated).
 */
export const cors = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const allowed = (c.env.WEB_ORIGIN ?? DEFAULT_ORIGIN).split(",").map((s) => s.trim());
  const origin = c.req.header("origin");
  if (origin && isAllowedOrigin(origin, allowed)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, Authorization, X-Session-Id, X-Shop-Slug");
  c.header("Access-Control-Expose-Headers", "Idempotent-Replayed, Retry-After, X-Session-Id, Set-Cookie");
  c.header("Access-Control-Max-Age", "86400");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});
