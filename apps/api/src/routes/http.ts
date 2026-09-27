import type { Context } from "hono";

export function pagination(c: Context): { page: number; limit: number; search?: string } {
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "20") || 20));
  const search = c.req.query("search") || undefined;
  return { page, limit, search };
}

export function serviceError(c: Context, err: unknown) {
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : "Something went wrong";
  if (code === "CONFLICT")
    return c.json({ success: false, error: { code, message } }, 409);
  if (code === "NOT_FOUND")
    return c.json({ success: false, error: { code, message } }, 404);
  if (code === "VALIDATION")
    return c.json({ success: false, error: { code, message } }, 400);
  if (code === "TRANSITION_LOCKED")
    return c.json({ success: false, error: { code, message } }, 409);
  if (code === "UNAUTHORIZED")
    return c.json({ success: false, error: { code, message } }, 401);
  if (code === "FORBIDDEN")
    return c.json({ success: false, error: { code, message } }, 403);
  throw err;
}
