import { createMiddleware } from "hono/factory";
import type { Env } from "../db/client";
import type { AppVariables } from "../middleware/auth";

/**
 * Per-shop view of the shared R2 bucket. Every key a shop reads, writes or
 * deletes is silently prefixed `t/{tenantId}/`, so one shop can never resolve
 * another shop's object, whatever key it is handed. The keys stored in the
 * shop's own database stay unprefixed, so they read the same everywhere.
 *
 * Pinned and unmanaged single-shop deploys resolve no workspace slug and keep
 * the bucket exactly as it was: no prefix, existing objects still found.
 */
export type ShopBucket = Pick<R2Bucket, "get" | "put" | "delete">;

export function tenantPrefix(tenantId: string): string {
  return `t/${tenantId}/`;
}

export function scopedBucket(r2: R2Bucket, tenantId: string | undefined): ShopBucket {
  if (!tenantId) return r2;
  const p = tenantPrefix(tenantId);
  return {
    get: (key: string, ...rest: unknown[]) => (r2.get as (k: string, ...r: unknown[]) => unknown)(p + key, ...rest),
    put: (key: string, ...rest: unknown[]) => (r2.put as (k: string, ...r: unknown[]) => unknown)(p + key, ...rest),
    delete: (keys: string | string[]) => r2.delete(Array.isArray(keys) ? keys.map((k) => p + k) : p + keys),
  } as ShopBucket;
}

type Ctx = { env: Env; get: (key: any) => unknown };

/** The bucket for this request's shop. Scoped only when a workspace was resolved from the request. */
export function shopR2(c: Ctx): ShopBucket {
  const slug = c.get("tenantSlug");
  const id = c.get("tenantId");
  return scopedBucket(c.env.R2, typeof slug === "string" && slug && typeof id === "string" ? id : undefined);
}

/** Total bytes stored under one shop's prefix. */
export async function shopStorageBytes(r2: R2Bucket, tenantId: string): Promise<number> {
  let bytes = 0;
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix: tenantPrefix(tenantId), cursor });
    for (const o of page.objects) bytes += o.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return bytes;
}

const MB = 1024 * 1024;

/**
 * Refuses an upload that would take the shop past its plan's storage. Uses the
 * latest usage snapshot (refreshed nightly) plus the incoming size, so it costs
 * one control-plane read instead of listing the bucket on every upload.
 */
export const enforceStorageLimit = createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
  const pdb = c.env.PLATFORM_DB;
  const tenantId = c.get("tenantId");
  if (!pdb || !tenantId || !c.get("tenantSlug")) return next();
  const row = await pdb
    .prepare(
      `SELECT p.max_storage_mb AS max_mb, p.name AS plan_name,
              (SELECT storage_mb FROM usage_snapshots WHERE tenant_id = s.tenant_id ORDER BY captured_at DESC LIMIT 1) AS used_mb
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = ?`
    )
    .bind(tenantId)
    .first<{ max_mb: number | null; plan_name: string; used_mb: number | null }>();
  if (!row || row.max_mb === null) return next();
  const incomingMb = Math.ceil(Number(c.req.header("content-length") ?? 0) / MB);
  if ((row.used_mb ?? 0) + incomingMb > row.max_mb)
    return c.json(
      { success: false, error: { code: "PLAN_LIMIT", message: `Your ${row.plan_name} plan includes ${row.max_mb} MB of file storage, and it is full. Upgrade to add more.` } },
      403
    );
  return next();
});
