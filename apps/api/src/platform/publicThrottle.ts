import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";

/**
 * D1-backed throttle for public endpoints (signup, lookup). A small
 * in-memory cache absorbs bursts per isolate; the table is authoritative
 * across isolates. Returns true when the call may proceed.
 */
const mem = new Map<string, { count: number; reset: number }>();

export async function checkPublicThrottle(
  pdb: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): Promise<boolean> {
  const cached = mem.get(key);
  if (cached && cached.reset > now) {
    if (cached.count >= limit) return false;
    cached.count += 1;
  } else {
    mem.set(key, { count: 1, reset: now + windowMs });
  }
  const row = await pdb
    .prepare("SELECT count, window_start FROM public_throttle WHERE key = ?")
    .bind(key)
    .first<{ count: number; window_start: number }>();
  if (!row || row.window_start + windowMs <= now) {
    await pdb
      .prepare("INSERT INTO public_throttle (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT (key) DO UPDATE SET count = 1, window_start = excluded.window_start")
      .bind(key, now)
      .run();
    return true;
  }
  if (row.count >= limit) return false;
  await pdb.prepare("UPDATE public_throttle SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}

/** For tests. */
export function resetPublicThrottle(): void {
  mem.clear();
}

export function throttleMiddleware(keyPrefix: string, limit: number, windowMs: number) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    if (!c.env.PLATFORM_DB) return next();
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    if (!(await checkPublicThrottle(c.env.PLATFORM_DB, `${keyPrefix}:${ip}`, limit, windowMs))) {
      c.header("Retry-After", String(Math.ceil(windowMs / 1000)));
      return c.json(
        { success: false, error: { code: "RATE_LIMITED", message: "Too many attempts. Try again in a little while." } },
        429
      );
    }
    await next();
  });
}
