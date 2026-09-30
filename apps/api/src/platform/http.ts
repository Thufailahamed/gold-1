import type { Context } from "hono";
import type { ZodType, ZodTypeDef } from "zod";
import { clientIp } from "./auth";
import type { Actor, PlatformEnv } from "./core";

type Parsed<T> = { ok: true; data: T } | { ok: false; res: Response };

/** Parses a JSON body; on failure answers 400 naming the first bad field, so forms can say what is wrong. */
export async function parseBody<T>(c: Context<PlatformEnv>, schema: ZodType<T, ZodTypeDef, unknown>): Promise<Parsed<T>> {
  const raw = await c.req.json().catch(() => null);
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  const field = issue?.path.join(".");
  return {
    ok: false,
    res: c.json(
      { success: false, error: { code: "VALIDATION", message: issue ? `${field ? `${field}: ` : ""}${issue.message}` : "Invalid request" } },
      400
    ),
  };
}

export function actor(c: Context<PlatformEnv>): Actor {
  return { id: c.get("adminId"), ip: clientIp(c) };
}

export function ok<T>(c: Context<PlatformEnv>, data: T, status: 200 | 201 = 200) {
  return c.json({ success: true as const, data }, status);
}

export function page(c: Context<PlatformEnv>, maxLimit = 100): { page: number; limit: number; search?: string } {
  const p = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(c.req.query("limit") ?? "25") || 25));
  const search = c.req.query("search")?.trim() || undefined;
  return { page: p, limit, search };
}

export function csv(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
